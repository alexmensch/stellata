// Pure algebra for the SID registry: designation grammar, canonical-key
// ladder, same-as classes, allocation, the registry codecs, and the
// head-snapshot + append-only checks. Contracts in /docs/sid.md#3-designation-namespaces through /docs/sid.md#5-synthetic-key-churn-wds-re-subdivision.

import { createHash } from 'node:crypto';

import type { Declared } from '../util/sources/source';
import { readTable, type TableRow, type TableSpec } from '../util/tsv/table-pure';
import { retiredSids, type EventRow } from './events-pure';
import {
  decodeLedgerRow, LEDGER_COLUMNS, SID_KINDS, type LedgerRow, type SidKind,
} from './ledger-pure';

// ---- Designation grammar (/docs/sid.md#3-designation-namespaces) -------------------------------

const NAMESPACE_RE = /^[a-z0-9_]+$/;

export interface Designation {
  ns: string;
  key: string;
}

export function parseDesignation(d: string): Designation {
  const colon = d.indexOf(':');
  if (colon <= 0) throw new Error(`designation "${d}": missing namespace separator`);
  const ns = d.slice(0, colon);
  const key = d.slice(colon + 1);
  if (!NAMESPACE_RE.test(ns)) throw new Error(`designation "${d}": bad namespace "${ns}"`);
  if (key.length === 0 || /\s/.test(key)) {
    throw new Error(`designation "${d}": key must be non-empty with no whitespace`);
  }
  return { ns, key };
}

export function isValidDesignation(d: string): boolean {
  try {
    parseDesignation(d);
    return true;
  } catch {
    return false;
  }
}

// ---- Star designation extraction (/docs/sid.md#3-designation-namespaces scripts/sid/README.md) -

/** Runtime synthetic-companion key prefix (`Star.syntheticId`,
 *  `catalog-row-index-map.json` `bySynth`); stripped to the `synth:` key. */
export const SYNTH_RUNTIME_PREFIX = 'synth-';

/** Runtime synthetic id → the Gaia DR3 source_id a stored same-as edge calls
 *  the same physical star. Companion promotion consults it so a member the
 *  catalogue already holds under that source is recognised rather than minted
 *  a twin — the row's own cells are empty, so nothing else can see the link. */
export function syntheticGaiaBridges(edges: SameasEdge[]): Map<string, string> {
  const bridges = new Map<string, string>();
  const add = (synth: string, gaia: string): void => {
    if (!synth.startsWith('synth:') || !gaia.startsWith('gaia_dr3:')) return;
    bridges.set(
      `${SYNTH_RUNTIME_PREFIX}${synth.slice('synth:'.length)}`,
      gaia.slice('gaia_dr3:'.length),
    );
  };
  for (const { a, b } of edges) {
    add(a, b);
    add(b, a);
  }
  return bridges;
}

export interface StarDesignationFields {
  isSol: boolean;
  hip: number | null;
  hd: number | null;
  hr: number | null;
  /** Further HD / HR numbers this record answers to, beyond the one the
   *  single-valued field carries. Carried only where the pair is unresolved, so
   *  the record renders both components' light and both numbers reach it
   *  (`/scripts/catalog/classic-ids/label-merge/README.md#an-alias-stops-at-the-blend`)
   * —
   *  which is why both key the same-as class. Required, not optional: this
   *  extractor has to derive one designation set for `sid:allocate` and the
   *  spine parity gate alike, and an omitted field is exactly the silent
   *  divergence `catalog-designations.ts` exists to prevent. */
  hdAlt: readonly number[];
  hrAlt: readonly number[];
  /** Raw AT-HYG Gliese/GJ cell; whitespace collapses to `_` per /docs/sid.md#3-designation-namespaces. */
  gl: string | null;
  gaiaSourceId: string | null;
  /** Synthetic key WITH its `synth-` prefix, or null. */
  syntheticId: string | null;
}

/** External designations for one catalog star. The single extractor:
 *  `sid:allocate` reaches it through `catalog-designations.ts` (over the
 *  built artifacts), `build-catalog` for its in-record resolution (over
 *  in-memory records), and the spine, label-merge and membership-manifest
 *  modules for the set a row stands in for — so none of them can derive a
 *  different class from the same record. */
export function starDesignations(f: StarDesignationFields): string[] {
  const d: string[] = [];
  if (f.isSol) d.push('sol:sun');
  if (f.hip !== null && f.hip > 0) d.push(`hip:${f.hip}`);
  if (f.hd !== null) d.push(`hd:${f.hd}`);
  for (const hd of f.hdAlt) d.push(`hd:${hd}`);
  if (f.hr !== null) d.push(`hr:${f.hr}`);
  for (const hr of f.hrAlt) d.push(`hr:${hr}`);
  if (f.gl) d.push(`gl:${f.gl.trim().replace(/\s+/g, '_')}`);
  if (f.syntheticId) {
    if (!f.syntheticId.startsWith(SYNTH_RUNTIME_PREFIX)) {
      throw new Error(`synthetic id "${f.syntheticId}" lacks the ${SYNTH_RUNTIME_PREFIX} prefix`);
    }
    d.push(`synth:${f.syntheticId.slice(SYNTH_RUNTIME_PREFIX.length)}`);
  }
  if (f.gaiaSourceId !== null) d.push(`gaia_dr3:${f.gaiaSourceId}`);
  return d;
}

// ---- Canonical-key ladder (/docs/sid.md#42-canonical-key--stability-first) ----------------------------

const LADDER_BEFORE_GAIA = ['sol', 'hip', 'hd', 'hr', 'gl'] as const;
const LADDER_AFTER_GAIA = ['synth', 'cloud', 'lg', 'shell'] as const;
const GAIA_RANK = LADDER_BEFORE_GAIA.length;

export function namespaceRank(ns: string): number {
  const pre = (LADDER_BEFORE_GAIA as readonly string[]).indexOf(ns);
  if (pre >= 0) return pre;
  if (ns.startsWith('gaia_')) return GAIA_RANK;
  const post = (LADDER_AFTER_GAIA as readonly string[]).indexOf(ns);
  if (post >= 0) return GAIA_RANK + 1 + post;
  throw new Error(
    `namespace "${ns}" has no canonical-key ladder position — ` +
      `extend the ladder in scripts/sid/sid-pure.ts (/docs/sid.md#10-adding-a-future-object-type--the-recipe step 1)`,
  );
}

const DIGITS_RE = /^\d+$/;

function trailingInt(s: string): number | null {
  const m = /(\d+)$/.exec(s);
  return m ? Number(m[1]) : null;
}

/** Ladder-first total order; earlier = preferred canonical key. Within the
 *  gaia_* rank, earlier releases sort first; keys compare numerically when
 *  both are all-digits, else lexicographically. */
export function compareDesignations(a: string, b: string): number {
  const da = parseDesignation(a);
  const db = parseDesignation(b);
  const ra = namespaceRank(da.ns);
  const rb = namespaceRank(db.ns);
  if (ra !== rb) return ra - rb;
  if (da.ns !== db.ns) {
    const ta = trailingInt(da.ns);
    const tb = trailingInt(db.ns);
    if (ta !== null && tb !== null && ta !== tb) return ta - tb;
    return da.ns < db.ns ? -1 : 1;
  }
  if (DIGITS_RE.test(da.key) && DIGITS_RE.test(db.key)) {
    const ka = BigInt(da.key);
    const kb = BigInt(db.key);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  }
  return da.key < db.key ? -1 : da.key > db.key ? 1 : 0;
}

export function canonicalKeyOf(designations: Iterable<string>): string {
  let best: string | null = null;
  for (const d of designations) {
    if (best === null || compareDesignations(d, best) < 0) best = d;
  }
  if (best === null) throw new Error('canonicalKeyOf: empty designation set');
  return best;
}

// ---- Ledger / registry codecs (/docs/sid.md#43-ledger--datasidledgertsv) ---------------------

export { SID_KINDS, type LedgerRow, type SidKind };

const SAMEAS_COLUMNS = ['a', 'b', 'note'] as const;
const OBJECT_MINT_COLUMNS = ['key', 'kind'] as const;

export const LEDGER_HEADER = LEDGER_COLUMNS.join('\t');
export const SAMEAS_HEADER = SAMEAS_COLUMNS.join('\t');
export const SOL_OBJECTS_HEADER = OBJECT_MINT_COLUMNS.join('\t');
export const SHELL_OBJECTS_HEADER = OBJECT_MINT_COLUMNS.join('\t');

export interface SameasEdge {
  a: string;
  b: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function registryRows<C extends string>(spec: TableSpec<C>, text: string): TableRow<C>[] {
  return [...readTable({ ...spec, exact: true }, text)];
}

export interface RegistryFile<R> {
  readonly rows: R[];
  readonly lines: string[];
}

export function registryFile<C extends string, R>(
  spec: TableSpec<C>,
  decode: (row: TableRow<C>) => R,
  text: string,
): RegistryFile<R> {
  const rows = registryRows(spec, text);
  return { rows: rows.map(decode), lines: rows.map((row) => row.rawLine) };
}

/** `from` is the file read: the curated overrides or one bridges/ file. */
export function parseSameasTsv(text: string, from: Declared): SameasEdge[] {
  return registryRows({ ...from, columns: SAMEAS_COLUMNS }, text).map((row) => {
    const a = row.raw('a');
    const b = row.raw('b');
    parseDesignation(a);
    parseDesignation(b);
    return { a, b };
  });
}

export interface SolObjectRow {
  key: string;
  kind: SidKind;
}

/** A `key\tkind` mint list (sol-objects / shell-objects), each key valid
 *  under the `<ns>:<key>` designation grammar. */
function parseObjectMintTsv(text: string, from: Declared, ns: string): SolObjectRow[] {
  return registryRows({ ...from, columns: OBJECT_MINT_COLUMNS }, text).map((row) => {
    const key = row.raw('key');
    parseDesignation(`${ns}:${key}`);
    return { key, kind: row.oneOf('kind', SID_KINDS) };
  });
}

export function parseSolObjectsTsv(text: string, from: Declared): SolObjectRow[] {
  return parseObjectMintTsv(text, from, 'sol');
}

export function parseShellObjectsTsv(text: string, from: Declared): SolObjectRow[] {
  return parseObjectMintTsv(text, from, 'shell');
}

// ---- Structural validation (/docs/sid.md#45-ci-guard check 1) -------------------

export function validateLedger(rows: LedgerRow[]): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  rows.forEach((row, i) => {
    if (row.sid !== i + 1) {
      errors.push(`sid ${row.sid} at row ${i + 1}: sids must be dense and ascending from 1`);
    }
    if (!isValidDesignation(row.canonicalKey)) {
      errors.push(`sid ${row.sid}: canonical key "${row.canonicalKey}" fails the designation grammar`);
    } else {
      try {
        namespaceRank(parseDesignation(row.canonicalKey).ns);
      } catch (e) {
        errors.push(`sid ${row.sid}: ${(e as Error).message}`);
      }
    }
    if (keys.has(row.canonicalKey)) {
      errors.push(`sid ${row.sid}: duplicate canonical key "${row.canonicalKey}"`);
    }
    keys.add(row.canonicalKey);
    if (!(SID_KINDS as readonly string[]).includes(row.kind)) {
      errors.push(`sid ${row.sid}: bad kind "${row.kind}"`);
    }
    if (!ISO_DATE_RE.test(row.firstSeen)) {
      errors.push(`sid ${row.sid}: bad first_seen "${row.firstSeen}"`);
    }
  });
  return errors;
}

// ---- Head snapshot + append-only check ----
// /docs/sid.md#43-ledger--datasidledgertsv, /docs/sid.md#45-ci-guard

export interface HeadTriple {
  rows: number;
  max_sid: number;
  sha256: string;
}

export interface LedgerHead {
  ledger: HeadTriple;
  /** Absent from heads written before events.tsv existed — readers treat
   *  absence as a zero-row frozen base. */
  events?: HeadTriple;
}

/** Hash of the data lines, each LF-terminated; the header line is pinned by
 *  the exact header check, not hashed. */
export function sha256OfDataLines(dataLines: string[]): string {
  const h = createHash('sha256');
  for (const line of dataLines) h.update(`${line}\n`, 'utf-8');
  return h.digest('hex');
}

function headTriple(file: RegistryFile<{ sid: number }>): HeadTriple {
  return {
    rows: file.rows.length,
    max_sid: file.rows.reduce((max, row) => Math.max(max, row.sid), 0),
    sha256: sha256OfDataLines(file.lines),
  };
}

export function computeLedgerHead(
  ledger: RegistryFile<LedgerRow>,
  events: RegistryFile<EventRow>,
): LedgerHead {
  return { ledger: headTriple(ledger), events: headTriple(events) };
}

export const EMPTY_HEAD_TRIPLE: HeadTriple = {
  rows: 0,
  max_sid: 0,
  sha256: sha256OfDataLines([]),
};

/** Append-only check against a frozen base head: the base's rows must
 *  survive byte-identical as the file's prefix. `newSidsPastBaseMax`
 *  additionally requires appended sids > base.max_sid (ledger only —
 *  a new retirement may legitimately retire an old sid). */
export function checkAppendOnly(
  base: HeadTriple,
  dataLines: string[],
  label: string,
  opts: { newSidsPastBaseMax: boolean },
): string[] {
  const errors: string[] = [];
  if (dataLines.length < base.rows) {
    errors.push(`${label}: ${dataLines.length} rows < frozen base ${base.rows} — rows deleted`);
    return errors;
  }
  const prefixSha = sha256OfDataLines(dataLines.slice(0, base.rows));
  if (prefixSha !== base.sha256) {
    errors.push(
      `${label}: frozen prefix (first ${base.rows} rows) was edited, deleted from, or ` +
        `reordered — the ledger is append-only (/docs/sid.md#45-ci-guard)`,
    );
  }
  if (opts.newSidsPastBaseMax) {
    const appended = registryRows(
      { file: label, columns: LEDGER_COLUMNS, hint: 'The ledger is append-only (/docs/sid.md#45-ci-guard).' },
      [LEDGER_HEADER, ...dataLines.slice(base.rows), ''].join('\n'),
    ).map(decodeLedgerRow);
    for (const { sid } of appended) {
      if (!(sid > base.max_sid)) {
        errors.push(`${label}: appended sid ${sid} not > frozen max_sid ${base.max_sid}`);
      }
    }
  }
  return errors;
}

// ---- Same-as classes + allocation ----
// /docs/sid.md#41-same-as-equivalence-graph, /docs/sid.md#44-allocation,
// /docs/sid.md#5-synthetic-key-churn-wds-re-subdivision

export class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    let root = x;
    while (true) {
      const p = this.parent.get(root);
      if (p === undefined || p === root) break;
      root = p;
    }
    let cur = x;
    while (cur !== root) {
      const p = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = p;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }

  add(x: string): void {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }

  has(x: string): boolean {
    return this.parent.has(x);
  }

  nodes(): IterableIterator<string> {
    return this.parent.keys();
  }
}

export interface SidObject {
  designations: string[];
  kind: SidKind;
  label: string;
}

export interface AllocateInput {
  objects: SidObject[];
  storedEdges: SameasEdge[];
  ledger: LedgerRow[];
  events: EventRow[];
  today: string;
}

export interface AmbiguousDesignation {
  designation: string;
  objects: number[];
}

export interface AllocateResult {
  errors: string[];
  keyless: number[];
  /** Non-retired ledger canonical keys whose class contains no current
   *  object, grouped by namespace. */
  orphaned: Map<string, string[]>;
  minted: LedgerRow[];
  /** Per input object: the sid its class resolved or minted to. */
  objectSids: number[];
  resolvedExisting: number;
  ambiguous: AmbiguousDesignation[];
  /** Classes covering >1 object (stored-edge merges). */
  mergedClasses: { sid: number; objects: number[] }[];
}

export interface SameAsClasses {
  classes: UnionFind;
  /** Per object, its designations less the ambiguous ones. */
  kept: string[][];
  ambiguous: AmbiguousDesignation[];
  /** Class root → the objects in it; an object with no kept designation is
   *  in none. */
  objectsByClass: Map<string, number[]>;
}

/** The same-as graph over each object's designations plus the stored edges.
 *  A designation carried by more than one object names a catalogue
 *  granularity (an HD number covering both members of a pair), not one
 *  physical object: it is dropped first, so it can neither key a ledger row
 *  nor fuse two objects' identities. Throws on a stored edge naming one,
 *  which would put it back in the graph. */
export function sameAsClasses(
  designationSets: readonly (readonly string[])[],
  storedEdges: readonly SameasEdge[],
): SameAsClasses {
  const owners = new Map<string, number[]>();
  designationSets.forEach((ds, i) => {
    for (const d of new Set(ds)) {
      const list = owners.get(d);
      if (list) list.push(i);
      else owners.set(d, [i]);
    }
  });
  const ambiguous: AmbiguousDesignation[] = [];
  for (const [designation, objs] of owners) {
    if (objs.length > 1) ambiguous.push({ designation, objects: objs });
  }
  const ambiguousSet = new Set(ambiguous.map((a) => a.designation));
  const kept = designationSets.map((ds) => [...new Set(ds)].filter((d) => !ambiguousSet.has(d)));
  const ambiguousEdges = storedEdges.filter((e) => ambiguousSet.has(e.a) || ambiguousSet.has(e.b));
  if (ambiguousEdges.length > 0) {
    throw new Error(
      `stored same-as edge(s) name a designation more than one object carries ` +
        `(/docs/sid.md#41-same-as-equivalence-graph): ` +
        ambiguousEdges.map((e) => `${e.a} = ${e.b}`).join(', '),
    );
  }

  const classes = new UnionFind();
  for (const ds of kept) {
    for (const d of ds) classes.add(d);
    for (let k = 1; k < ds.length; k++) classes.union(ds[0], ds[k]);
  }
  for (const edge of storedEdges) {
    classes.add(edge.a);
    classes.add(edge.b);
    classes.union(edge.a, edge.b);
  }
  const objectsByClass = new Map<string, number[]>();
  kept.forEach((ds, i) => {
    if (ds.length === 0) return;
    const root = classes.find(ds[0]);
    const list = objectsByClass.get(root);
    if (list) list.push(i);
    else objectsByClass.set(root, [i]);
  });
  return { classes, kept, ambiguous, objectsByClass };
}

export function allocate(input: AllocateInput): AllocateResult {
  const { objects, storedEdges, ledger, events, today } = input;
  const errors: string[] = [];

  for (const obj of objects) {
    for (const d of obj.designations) parseDesignation(d);
  }

  const { classes: uf, kept, ambiguous, objectsByClass } = sameAsClasses(
    objects.map((o) => o.designations),
    storedEdges,
  );
  const keyless = kept.flatMap((ds, i) => (ds.length === 0 ? [i] : []));
  for (const row of ledger) uf.add(row.canonicalKey);

  const retiredBySid = retiredSids(events);
  const rowsByRoot = new Map<string, LedgerRow[]>();
  for (const row of ledger) {
    const root = uf.find(row.canonicalKey);
    const list = rowsByRoot.get(root);
    if (list) list.push(row);
    else rowsByRoot.set(root, [row]);
  }

  const membersByRoot = new Map<string, string[]>();
  for (const node of uf.nodes()) {
    const root = uf.find(node);
    const list = membersByRoot.get(root);
    if (list) list.push(node);
    else membersByRoot.set(root, [node]);
  }

  for (const [root, rows] of rowsByRoot) {
    if (!objectsByClass.has(root)) continue;
    const active = rows.filter((r) => !retiredBySid.has(r.sid));
    if (active.length > 1) {
      errors.push(
        `class {${membersByRoot.get(root)!.join(', ')}} spans ${active.length} active sids ` +
          `(${active.map((r) => `${r.sid}=${r.canonicalKey}`).join(', ')}) — resolve the ` +
          `merge first: a merge event in events.tsv for all but one`,
      );
    } else if (active.length === 0) {
      errors.push(
        `class {${membersByRoot.get(root)!.join(', ')}} matches only retired sids ` +
          `(${rows.map((r) => r.sid).join(', ')}) — a retired object reappeared; ` +
          `append a reinstate event to data/sid/events.tsv (the object resumes its ` +
          `original sid) or bridge/merge if its identity changed (/docs/sid.md#43-ledger--datasidledgertsv)`,
      );
    }
  }

  const orphaned = new Map<string, string[]>();
  for (const row of ledger) {
    if (retiredBySid.has(row.sid)) continue;
    if (objectsByClass.has(uf.find(row.canonicalKey))) continue;
    const ns = parseDesignation(row.canonicalKey).ns;
    const list = orphaned.get(ns);
    if (list) list.push(row.canonicalKey);
    else orphaned.set(ns, [row.canonicalKey]);
  }

  const minted: LedgerRow[] = [];
  const objectSids = new Array<number>(objects.length).fill(0);
  const sidByRoot = new Map<string, number>();
  const kindBySid = new Map<number, SidKind>(ledger.map((r) => [r.sid, r.kind]));
  let resolvedExisting = 0;
  let nextSid = ledger.reduce((max, r) => Math.max(max, r.sid), 0) + 1;

  objects.forEach((obj, i) => {
    if (kept[i].length === 0) return;
    const root = uf.find(kept[i][0]);
    let sid = sidByRoot.get(root);
    if (sid === undefined) {
      const active = (rowsByRoot.get(root) ?? []).filter((r) => !retiredBySid.has(r.sid));
      if (active.length === 1) {
        sid = active[0].sid;
        resolvedExisting++;
      } else if (active.length === 0 && (rowsByRoot.get(root) ?? []).length === 0) {
        sid = nextSid++;
        minted.push({
          sid,
          canonicalKey: canonicalKeyOf(membersByRoot.get(root)!),
          kind: obj.kind,
          firstSeen: today,
        });
        kindBySid.set(sid, obj.kind);
      } else {
        return; // merge/retirement conflict already reported in errors
      }
      sidByRoot.set(root, sid);
    }
    if (kindBySid.get(sid) !== obj.kind) {
      errors.push(
        `${obj.label}: kind "${obj.kind}" conflicts with sid ${sid}'s ledger kind ` +
          `"${kindBySid.get(sid)}"`,
      );
    }
    objectSids[i] = sid;
  });

  const mergedClasses: { sid: number; objects: number[] }[] = [];
  for (const [root, indices] of objectsByClass) {
    if (indices.length > 1) {
      mergedClasses.push({ sid: sidByRoot.get(root) ?? 0, objects: indices });
    }
  }

  return {
    errors,
    keyless,
    orphaned,
    minted,
    objectSids,
    resolvedExisting,
    ambiguous,
    mergedClasses,
  };
}

export interface SidResolution {
  /** Per input object, its resolved ledger sid — 0 (NO_SID) whenever the
   *  object is unresolved (keyless, would-mint, or a merge/kind conflict). */
  objectSids: number[];
  /** Non-empty iff any object is unallocated / keyless / conflicting. The
   *  caller must run `pnpm run sid:allocate` to reconcile before shipping. */
  errors: string[];
}

/** resolveSids resolves against the frozen ledger without minting, so it
 *  needs everything allocate does except the mint date. */
export type ResolveInput = Omit<AllocateInput, 'today'>;

/** Read-only allocation: resolve every object to its EXISTING ledger sid,
 *  treating any object that would mint a new row (or is keyless / conflicts)
 *  as an error and leaving its sid at 0 (NO_SID). This is the resolver the
 *  artifact emitters use — the build never mints; `sid:allocate` is the sole
 *  ledger writer (/docs/sid.md#44-allocation). */
export function resolveSids(input: ResolveInput): SidResolution {
  const result = allocate({ ...input, today: '' });
  const mintedSids = new Set(result.minted.map((r) => r.sid));
  const errors = [...result.errors];
  for (const i of result.keyless) {
    errors.push(`${input.objects[i].label}: no usable designation (keyless)`);
  }
  input.objects.forEach((obj, i) => {
    if (mintedSids.has(result.objectSids[i])) {
      errors.push(`${obj.label}: unallocated (${obj.designations.join(', ')})`);
      result.objectSids[i] = 0;
    }
  });
  return { objectSids: result.objectSids, errors };
}

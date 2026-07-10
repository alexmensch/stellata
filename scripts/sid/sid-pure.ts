// Pure algebra for the SID registry: designation grammar, canonical-key
// ladder, same-as classes, allocation, ledger/retirements codecs, and the
// head-snapshot + append-only checks. Contracts in docs/sid.md §§ 3-5.

import { createHash } from 'node:crypto';

// ---- Designation grammar (docs/sid.md § 3) -------------------------------

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

// ---- Star designation extraction (docs/sid.md § 3, scripts/sid/README.md) -

/** Runtime synthetic-companion key prefix (`Star.syntheticId`,
 *  `catalog-row-index-map.json` `bySynth`); stripped to the `synth:` key. */
export const SYNTH_RUNTIME_PREFIX = 'synth-';

export interface StarDesignationFields {
  isSol: boolean;
  hip: number | null;
  hd: number | null;
  hr: number | null;
  /** Raw AT-HYG Gliese/GJ cell; whitespace collapses to `_` per § 3. */
  gl: string | null;
  gaiaSourceId: string | null;
  /** Synthetic key WITH its `synth-` prefix, or null. */
  syntheticId: string | null;
}

/** External designations for one catalog star. The single extractor shared
 *  by `sid:allocate` (over the built artifacts) and `build-catalog`'s
 *  in-record resolution (over its in-memory records) so both derive an
 *  identical class from the same record. */
export function starDesignations(f: StarDesignationFields): string[] {
  const d: string[] = [];
  if (f.isSol) d.push('sol:sun');
  if (f.hip !== null && f.hip > 0) d.push(`hip:${f.hip}`);
  if (f.hd !== null) d.push(`hd:${f.hd}`);
  if (f.hr !== null) d.push(`hr:${f.hr}`);
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

// ---- Canonical-key ladder (docs/sid.md § 4.2) ----------------------------

const LADDER_BEFORE_GAIA = ['sol', 'hip', 'hd', 'hr', 'gl'] as const;
const LADDER_AFTER_GAIA = ['synth', 'cloud', 'lg'] as const;
const GAIA_RANK = LADDER_BEFORE_GAIA.length;

export function namespaceRank(ns: string): number {
  const pre = (LADDER_BEFORE_GAIA as readonly string[]).indexOf(ns);
  if (pre >= 0) return pre;
  if (ns.startsWith('gaia_')) return GAIA_RANK;
  const post = (LADDER_AFTER_GAIA as readonly string[]).indexOf(ns);
  if (post >= 0) return GAIA_RANK + 1 + post;
  throw new Error(
    `namespace "${ns}" has no canonical-key ladder position — ` +
      `extend the ladder in scripts/sid/sid-pure.ts (docs/sid.md § 10 step 1)`,
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

// ---- Ledger / retirements codecs (docs/sid.md § 4.3) ---------------------

export const SID_KINDS = ['star', 'cloud', 'galaxy', 'planet'] as const;
export type SidKind = (typeof SID_KINDS)[number];

export const LEDGER_HEADER = 'sid\tcanonical_key\tkind\tfirst_seen';
export const RETIREMENTS_HEADER = 'sid\tretired\treason\tsuccessor_sid';
export const SAMEAS_HEADER = 'a\tb\tnote';
export const SOL_OBJECTS_HEADER = 'key\tkind';

export interface LedgerRow {
  sid: number;
  canonicalKey: string;
  kind: SidKind;
  firstSeen: string;
}

export interface RetirementRow {
  sid: number;
  retired: string;
  reason: string;
  successorSid: number | null;
}

export interface SameasEdge {
  a: string;
  b: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface TsvFile {
  header: string;
  dataLines: string[];
}

/** Strict TSV split: LF line endings, trailing newline required, no blank
 *  interior lines. */
export function splitTsv(text: string, expectedHeader: string, label: string): TsvFile {
  if (text.includes('\r')) throw new Error(`${label}: CR line endings not allowed`);
  if (!text.endsWith('\n')) throw new Error(`${label}: missing trailing newline`);
  const lines = text.slice(0, -1).split('\n');
  if (lines[0] !== expectedHeader) {
    throw new Error(`${label}: bad header "${lines[0]}" (expected "${expectedHeader}")`);
  }
  const dataLines = lines.slice(1);
  if (dataLines.some((l) => l.length === 0)) throw new Error(`${label}: blank data line`);
  return { header: lines[0], dataLines };
}

export function parseLedgerLine(line: string): LedgerRow {
  const cells = line.split('\t');
  if (cells.length !== 4) throw new Error(`ledger row "${line}": expected 4 columns`);
  const [sidStr, canonicalKey, kind, firstSeen] = cells;
  if (!DIGITS_RE.test(sidStr)) throw new Error(`ledger row "${line}": bad sid`);
  return { sid: Number(sidStr), canonicalKey, kind: kind as SidKind, firstSeen };
}

export function parseLedgerTsv(text: string): LedgerRow[] {
  return splitTsv(text, LEDGER_HEADER, 'ledger.tsv').dataLines.map(parseLedgerLine);
}

export function serializeLedgerRow(row: LedgerRow): string {
  return `${row.sid}\t${row.canonicalKey}\t${row.kind}\t${row.firstSeen}`;
}

export function parseRetirementLine(line: string): RetirementRow {
  const cells = line.split('\t');
  if (cells.length !== 4) throw new Error(`retirement row "${line}": expected 4 columns`);
  const [sidStr, retired, reason, successorStr] = cells;
  if (!DIGITS_RE.test(sidStr)) throw new Error(`retirement row "${line}": bad sid`);
  if (successorStr !== '' && !DIGITS_RE.test(successorStr)) {
    throw new Error(`retirement row "${line}": bad successor_sid`);
  }
  return {
    sid: Number(sidStr),
    retired,
    reason,
    successorSid: successorStr === '' ? null : Number(successorStr),
  };
}

export function parseRetirementsTsv(text: string): RetirementRow[] {
  return splitTsv(text, RETIREMENTS_HEADER, 'retirements.tsv').dataLines.map(
    parseRetirementLine,
  );
}

export function parseSameasTsv(text: string, label: string): SameasEdge[] {
  return splitTsv(text, SAMEAS_HEADER, label).dataLines.map((line) => {
    const cells = line.split('\t');
    if (cells.length !== 3) throw new Error(`${label} row "${line}": expected 3 columns`);
    const [a, b] = cells;
    parseDesignation(a);
    parseDesignation(b);
    return { a, b };
  });
}

export interface SolObjectRow {
  key: string;
  kind: SidKind;
}

export function parseSolObjectsTsv(text: string): SolObjectRow[] {
  return splitTsv(text, SOL_OBJECTS_HEADER, 'sol-objects.tsv').dataLines.map((line) => {
    const cells = line.split('\t');
    if (cells.length !== 2) throw new Error(`sol-objects row "${line}": expected 2 columns`);
    const [key, kind] = cells;
    parseDesignation(`sol:${key}`);
    if (!(SID_KINDS as readonly string[]).includes(kind)) {
      throw new Error(`sol-objects row "${line}": bad kind "${kind}"`);
    }
    return { key, kind: kind as SidKind };
  });
}

// ---- Structural validation (docs/sid.md § 4.5 check 1) -------------------

export function validateLedger(rows: LedgerRow[]): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  rows.forEach((row, i) => {
    if (row.sid !== i + 1) {
      errors.push(`sid ${row.sid} at row ${i + 1}: sids must be dense and ascending from 1`);
    }
    if (!isValidDesignation(row.canonicalKey)) {
      errors.push(`sid ${row.sid}: canonical key "${row.canonicalKey}" fails the § 3 grammar`);
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

export function validateRetirements(
  rows: RetirementRow[],
  ledgerRows: LedgerRow[],
): string[] {
  const errors: string[] = [];
  const maxSid = ledgerRows.length;
  const seen = new Set<number>();
  for (const row of rows) {
    if (row.sid < 1 || row.sid > maxSid) {
      errors.push(`retirement of sid ${row.sid}: sid not in ledger`);
    }
    if (seen.has(row.sid)) errors.push(`retirement of sid ${row.sid}: duplicate retirement`);
    seen.add(row.sid);
    if (!ISO_DATE_RE.test(row.retired)) {
      errors.push(`retirement of sid ${row.sid}: bad retired date "${row.retired}"`);
    }
    if (row.reason.trim().length === 0) {
      errors.push(`retirement of sid ${row.sid}: empty reason`);
    }
    if (row.successorSid !== null) {
      if (row.successorSid === row.sid) {
        errors.push(`retirement of sid ${row.sid}: successor is itself`);
      } else if (row.successorSid < 1 || row.successorSid > maxSid) {
        errors.push(`retirement of sid ${row.sid}: successor ${row.successorSid} not in ledger`);
      }
    }
  }
  return errors;
}

// ---- Head snapshot + append-only check (docs/sid.md §§ 4.3, 4.5) ---------

export interface HeadTriple {
  rows: number;
  max_sid: number;
  sha256: string;
}

export interface LedgerHead {
  ledger: HeadTriple;
  retirements: HeadTriple;
}

/** Hash of the first `rows.length` data lines, each LF-terminated; the
 *  header line is pinned by splitTsv, not hashed. */
export function sha256OfDataLines(dataLines: string[]): string {
  const h = createHash('sha256');
  for (const line of dataLines) h.update(`${line}\n`, 'utf-8');
  return h.digest('hex');
}

function headTriple(dataLines: string[], sids: number[]): HeadTriple {
  return {
    rows: dataLines.length,
    max_sid: sids.reduce((max, sid) => Math.max(max, sid), 0),
    sha256: sha256OfDataLines(dataLines),
  };
}

export function computeLedgerHead(ledgerText: string, retirementsText: string): LedgerHead {
  const ledger = splitTsv(ledgerText, LEDGER_HEADER, 'ledger.tsv');
  const retirements = splitTsv(retirementsText, RETIREMENTS_HEADER, 'retirements.tsv');
  return {
    ledger: headTriple(
      ledger.dataLines,
      ledger.dataLines.map((l) => parseLedgerLine(l).sid),
    ),
    retirements: headTriple(
      retirements.dataLines,
      retirements.dataLines.map((l) => parseRetirementLine(l).sid),
    ),
  };
}

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
        `reordered — the ledger is append-only (docs/sid.md § 4.5)`,
    );
  }
  if (opts.newSidsPastBaseMax) {
    for (const line of dataLines.slice(base.rows)) {
      const sid = Number(line.split('\t')[0]);
      if (!(sid > base.max_sid)) {
        errors.push(`${label}: appended sid ${sid} not > frozen max_sid ${base.max_sid}`);
      }
    }
  }
  return errors;
}

/** Git-LFS pointer stub — the file content is elsewhere; content checks
 *  must skip rather than "validate" the stub. */
export function isLfsPointer(text: string): boolean {
  return text.startsWith('version https://git-lfs.github.com/spec/');
}

// ---- Same-as classes + allocation (docs/sid.md §§ 4.1, 4.4, 5) -----------

class UnionFind {
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
  retirements: RetirementRow[];
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

/** Designations carried by more than one object name a catalogue
 *  granularity (an HD number covering both members of a pair), not one
 *  physical object: they are dropped from the same-as graph so they can
 *  neither key a ledger row nor fuse two objects' identities. */
export function dropAmbiguousDesignations(objects: SidObject[]): {
  kept: string[][];
  ambiguous: AmbiguousDesignation[];
} {
  const owners = new Map<string, number[]>();
  objects.forEach((obj, i) => {
    for (const d of new Set(obj.designations)) {
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
  const kept = objects.map((obj) =>
    [...new Set(obj.designations)].filter((d) => !ambiguousSet.has(d)),
  );
  return { kept, ambiguous };
}

export function allocate(input: AllocateInput): AllocateResult {
  const { objects, storedEdges, ledger, retirements, today } = input;
  const errors: string[] = [];

  for (const obj of objects) {
    for (const d of obj.designations) parseDesignation(d);
  }

  const { kept, ambiguous } = dropAmbiguousDesignations(objects);
  const keyless = kept.flatMap((ds, i) => (ds.length === 0 ? [i] : []));

  const uf = new UnionFind();
  for (const ds of kept) {
    for (const d of ds) uf.add(d);
    for (let k = 1; k < ds.length; k++) uf.union(ds[0], ds[k]);
  }
  for (const edge of storedEdges) {
    uf.add(edge.a);
    uf.add(edge.b);
    uf.union(edge.a, edge.b);
  }
  for (const row of ledger) uf.add(row.canonicalKey);

  const retiredBySid = new Map(retirements.map((r) => [r.sid, r]));
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

  const objectRootIndices = new Map<string, number[]>();
  objects.forEach((_, i) => {
    if (kept[i].length === 0) return;
    const root = uf.find(kept[i][0]);
    const list = objectRootIndices.get(root);
    if (list) list.push(i);
    else objectRootIndices.set(root, [i]);
  });

  for (const [root, rows] of rowsByRoot) {
    if (!objectRootIndices.has(root)) continue;
    const active = rows.filter((r) => !retiredBySid.has(r.sid));
    if (active.length > 1) {
      errors.push(
        `class {${membersByRoot.get(root)!.join(', ')}} spans ${active.length} active sids ` +
          `(${active.map((r) => `${r.sid}=${r.canonicalKey}`).join(', ')}) — resolve the ` +
          `merge first: retire all but one with successor_sid in retirements.tsv`,
      );
    } else if (active.length === 0) {
      errors.push(
        `class {${membersByRoot.get(root)!.join(', ')}} matches only retired sids ` +
          `(${rows.map((r) => r.sid).join(', ')}) — a retired object reappeared; ` +
          `resolve manually before allocating`,
      );
    }
  }

  const orphaned = new Map<string, string[]>();
  for (const row of ledger) {
    if (retiredBySid.has(row.sid)) continue;
    if (objectRootIndices.has(uf.find(row.canonicalKey))) continue;
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
  for (const [root, indices] of objectRootIndices) {
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
  /** Per input object, its resolved ledger sid (0 = unresolved). */
  objectSids: number[];
  /** Non-empty iff any object is unallocated / keyless / conflicting. The
   *  caller must run `npm run sid:allocate` to reconcile before shipping. */
  errors: string[];
}

/** Read-only allocation: resolve every object to its EXISTING ledger sid,
 *  treating any object that would mint a new row (or is keyless / conflicts)
 *  as an error. This is the resolver the artifact emitters use — the build
 *  never mints; `sid:allocate` is the sole ledger writer (docs/sid.md
 *  § 4.4). */
export function resolveSids(input: AllocateInput): SidResolution {
  const result = allocate(input);
  const mintedSids = new Set(result.minted.map((r) => r.sid));
  const errors = [...result.errors];
  for (const i of result.keyless) {
    errors.push(`${input.objects[i].label}: no usable designation (keyless)`);
  }
  input.objects.forEach((obj, i) => {
    const sid = result.objectSids[i];
    if (sid !== 0 && mintedSids.has(sid)) {
      errors.push(`${obj.label}: unallocated (${obj.designations.join(', ')})`);
    }
  });
  return { objectSids: result.objectSids, errors };
}

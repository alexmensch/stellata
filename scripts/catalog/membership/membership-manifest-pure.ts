// The primaries-derived membership manifest: row assembly from the spine plus
// the primaries' additions, the two ledgers, the TSV codecs, and the
// spine ↔ manifest matcher the parity gate runs. Contract: docs/catalog-driver.md § 3.1.

import { SOL_PROPER_NAME, normaliseGjKey } from '../catalog-pure';
import type { Cns5Row } from '../classic-ids/classic-ids-parse';
import type { ClassicIdOverlay } from '../classic-ids/classic-id-overlay-pure';
import {
  mergeClassicIdLabels,
  spineLabelMergeRecord,
  type LabelFlip,
  type LabelMergeCounts,
  type LabelMergeRecord,
  type LabelOverrides,
} from '../classic-ids/label-merge-pure';
import { parkedRecordKey } from '../distance/parallax/parked-ledger';
import { parseIntOrNull } from '../parse/corpus-tsv';
import type { SpineRow } from '../spine/inherited-spine-pure';
import {
  ATHYG_HD_LINK_FLOOR,
  CLASSICAL_CELLS,
  attestHd,
  attestSpineRow,
  checkIdentity,
  findAdditions,
  indexPrimaries,
  spineKeys,
  type ClassicalCell,
  type HdAddition,
  type HipAddition,
  type IdentityCheck,
  type PrimaryIndex,
  type PrimaryTables,
  type RowAttestation,
} from '../spine/primaries-audit-pure';
import {
  UnionFind,
  canonicalKeyOf,
  compareDesignations,
  starDesignations,
  type SameasEdge,
} from '../../sid/sid-pure';

export const MEMBERSHIP_MANIFEST_FILE = 'data/membership/membership-manifest.tsv';
export const ADDITIONS_LEDGER_FILE = 'data/membership/additions-ledger.tsv';
export const BINDING_REVIEW_FILE = 'data/membership/binding-review.tsv';
export const MEMBERSHIP_EXPECTED_FILE =
  'scripts/catalog/membership/membership-manifest-expected.json';

/** Multi-value separator inside `hd_alt` / `hr_alt` / `routes`. */
export const MANIFEST_VALUE_SEPARATOR = '|';

export const MANIFEST_COLUMNS = [
  'tyc', 'hip', 'hd', 'hd_alt', 'hr', 'hr_alt', 'gl', 'flam', 'bayer', 'proper',
  'gaia_source_id', 'binding', 'routes',
] as const;
export type ManifestColumn = (typeof MANIFEST_COLUMNS)[number];
export type ManifestRow = Record<ManifestColumn, string>;

/** How the row's `gaia_source_id` is justified. `crosswalk_gated` is a raw
 *  cross-walk binding the § 4 gate passed; `simbad_corroborated` is a spine
 *  binding no walk reproduces but SIMBAD's object for that id carries the
 *  record's own TYC / HIP / GJ; `reviewed` is a spine binding neither reaches
 *  that a committed disposition row keeps on stated evidence; `none` is an
 *  empty cell. */
export const BINDING_CLASSES = [
  'crosswalk_gated', 'simbad_corroborated', 'reviewed', 'none',
] as const;
export type BindingClass = (typeof BINDING_CLASSES)[number];

export const BINDING_DISPOSITIONS_FILE = 'data/membership/binding-review-dispositions.tsv';
export const BINDING_DISPOSITION_COLUMNS = [
  'gaia_source_id', 'disposition', 'basis', 'evidence',
] as const;
export const BINDING_DISPOSITIONS = ['keep', 'drop'] as const;
export type BindingDisposition = (typeof BINDING_DISPOSITIONS)[number];
/** What a disposition rests on: the record's own Tycho-2 position against the
 *  Gaia source; V/70A's position and proper motion against it; SIMBAD's object
 *  under the id in the Gaia DR2 namespace carrying the record's designation. */
export const BINDING_DISPOSITION_BASES = [
  'tycho2_position', 'v70a_astrometry', 'simbad_dr2_object',
] as const;
export type BindingDispositionBasis = (typeof BINDING_DISPOSITION_BASES)[number];
export interface BindingDispositionRow {
  gaia_source_id: string;
  disposition: BindingDisposition;
  basis: BindingDispositionBasis;
  evidence: string;
}

export const LABEL_DROPS_FILE = 'data/membership/label-drops.tsv';
export const LABEL_DROP_COLUMNS = [
  'tyc', 'hip', 'hd', 'gl', 'gaia_source_id', 'cell', 'value', 'reason',
] as const;
export type LabelDropRow = Record<(typeof LABEL_DROP_COLUMNS)[number], string>;
/** The § 6.2 reasons a spine label leaves the manifest: no primary publishes
 *  that Flamsteed number, or that HD number, for the star. */
export const LABEL_DROP_REASONS = ['flamsteed_unattested', 'hd_unattested'] as const;
export type LabelDropReason = (typeof LABEL_DROP_REASONS)[number];

/** The § 6.1 reason enum for records the primaries admit that the spine lacked. */
export const ADDITION_REASONS = [
  'admitted:hd_link_gap',
  'admitted:hd_omitted',
  'admitted:hip_omitted',
  'admitted:cns5_census',
] as const;
export type AdditionReason = (typeof ADDITION_REASONS)[number];

/** A primary's row whose every designation a spine record already answers to,
 *  so admitting it would make that record's SID key ambiguous. Ledgered onto
 *  the record it resolves to rather than admitted; the suffix is that record's
 *  designation. */
export const COMPONENT_REASON_PREFIX = 'component:';

export const LEDGER_COLUMNS = ['tyc', 'hip', 'hd', 'gl', 'gaia_source_id', 'reason'] as const;
export type AdditionLedgerRow = Record<(typeof LEDGER_COLUMNS)[number], string>;

export const BINDING_REVIEW_COLUMNS = [
  'tyc', 'hip', 'hd', 'hr', 'gl', 'gaia_source_id', 'verdict', 'via_tyc', 'via_hip',
  'via_cns5', 'simbad', 'simbad_hip', 'simbad_tyc', 'simbad_gj',
] as const;
export type BindingReviewRow = Record<(typeof BINDING_REVIEW_COLUMNS)[number], string>;

export interface MembershipInput {
  spine: readonly SpineRow[];
  tables: PrimaryTables;
  /** The committed post-gate overlay: `has(source)` is the § 4 gate's verdict
   *  on every raw cross-walk binding, spine row or not. */
  overlay: ClassicIdOverlay;
  overrides: LabelOverrides;
  siblingRenderedSourceIds: ReadonlySet<string>;
  /** The committed dispositions of the binding review queue, by source_id. */
  dispositions: ReadonlyMap<string, BindingDispositionRow>;
}

export interface MembershipCounts extends LabelMergeCounts {
  rows: number;
  spineRows: number;
  additionRows: number;
  additionsByReason: Record<AdditionReason, number>;
  /** Groups a primary admits that resolve onto an existing record instead. */
  componentRows: number;
  bindingByClass: Record<BindingClass, number>;
  /** Spine bindings dropped into the review queue. */
  bindingReviewRows: number;
  /** Spine labels the manifest leaves out, per § 6.2 reason. */
  labelDropsByReason: Record<LabelDropReason, number>;
  /** Manifest cells no primary attests, per identifier. */
  unattestedByCell: Record<ClassicalCell, number>;
  /** Addition groups whose raw source is a spine record's, so the cell stays
   *  empty: Gaia fitted one source where Tycho-2 resolved two stars. */
  additionSourceOnSpine: number;
  /** Addition groups whose raw source the § 4 gate refused. */
  additionSourceGateRefused: number;
  /** Raw sources two or more addition groups reach; no group takes one. */
  additionSourceShared: number;
  /** Admitted rows whose only designation is the Gaia id — the mints
   *  `sid:allocate` would key `gaia_dr3:`. Zero by construction, since a group
   *  with no classical designation left is ledgered rather than admitted; the
   *  pin is the tripwire on an admission branch that stops holding that. It
   *  says what it says only alongside `sharedDesignations` — a designation two
   *  rows carry keys neither of them, so a row can fall through to the Gaia id
   *  with a classical cell filled. */
  additionGaiaKeyedOnly: number;
  /** Designations more than one manifest row carries, so they key no SID
   *  (docs/sid.md § 4.1). Admission leaves none that involves an addition;
   *  what remains is the spine's own, which key on a higher rung. */
  sharedDesignations: number;
  /** Groups whose TYC route and HIP route bind different sources; the TYC
   *  route's stands, as the HD route does for labels (§ 4). */
  additionRouteSourceDisagree: number;
  /** Admitted rows the guard withheld a designation from — the record ships,
   *  but without a designation the primaries publish for it, because another
   *  record answers to it. */
  additionsWithBlockedDesignation: number;
  rowsWithHdAlt: number;
  rowsWithHrAlt: number;
}

export interface MembershipResult {
  rows: ManifestRow[];
  ledger: AdditionLedgerRow[];
  bindingReview: BindingReviewRow[];
  labelDrops: LabelDropRow[];
  /** The spine-side label merge's review queue — must equal the committed
   *  `label_flips.tsv` while the record build still merges for itself. */
  flips: LabelFlip[];
  counts: MembershipCounts;
}

// ---- codecs ------------------------------------------------------------------

function pushKeyed<K, V>(by: Map<K, V[]>, key: K, value: V): void {
  const list = by.get(key);
  if (list === undefined) by.set(key, [value]);
  else list.push(value);
}

function joinValues(values: readonly (string | number)[]): string {
  return values.map(String).join(MANIFEST_VALUE_SEPARATOR);
}

function splitValues(cell: string): string[] {
  return cell === '' ? [] : cell.split(MANIFEST_VALUE_SEPARATOR);
}

export function serializeManifest(rows: readonly ManifestRow[]): string {
  const lines = [MANIFEST_COLUMNS.join('\t')];
  for (const row of rows) {
    lines.push(MANIFEST_COLUMNS.map((c) => {
      if (/[\t\n\r]/.test(row[c])) {
        throw new Error(`manifest cell ${c}="${row[c]}" contains a TSV delimiter`);
      }
      return row[c];
    }).join('\t'));
  }
  return `${lines.join('\n')}\n`;
}

/** Demands the header byte for byte, as `iterSpineTsv` does: the only writers
 *  are this module's serializers, so a header that merely parses was never
 *  shipped. Walks the text rather than splitting it — the manifest runs to tens
 *  of megabytes, and every reader here shares the walk. */
function* tsvRows(
  text: string, columns: readonly string[], label: string,
): Generator<string[]> {
  const headerEnd = text.indexOf('\n');
  const header = headerEnd === -1 ? text : text.slice(0, headerEnd);
  if (header !== columns.join('\t')) {
    throw new Error(`${label}: header mismatch: got ${header}`);
  }
  let start = headerEnd === -1 ? text.length : headerEnd + 1;
  while (start < text.length) {
    const end = text.indexOf('\n', start);
    const line = text.slice(start, end === -1 ? text.length : end);
    start = end === -1 ? text.length : end + 1;
    if (line === '') continue;
    const cells = line.split('\t');
    if (cells.length !== columns.length) {
      throw new Error(
        `${label}: row has ${cells.length} cells, expected ${columns.length}: "${line}"`,
      );
    }
    yield cells;
  }
}

function rowFrom<C extends string>(
  columns: readonly C[], cells: readonly string[],
): Record<C, string> {
  const row = {} as Record<C, string>;
  columns.forEach((c, i) => { row[c] = cells[i]; });
  return row;
}

export function* iterManifestTsv(text: string): Generator<ManifestRow> {
  for (const cells of tsvRows(text, MANIFEST_COLUMNS, MEMBERSHIP_MANIFEST_FILE)) {
    yield rowFrom(MANIFEST_COLUMNS, cells);
  }
}

export function parseManifestTsv(text: string): ManifestRow[] {
  return [...iterManifestTsv(text)];
}

export function serializeLedger(rows: readonly AdditionLedgerRow[]): string {
  const lines = rows.map((r) => LEDGER_COLUMNS.map((c) => r[c]).join('\t')).sort();
  return `${[LEDGER_COLUMNS.join('\t'), ...lines].join('\n')}\n`;
}

export function parseLedgerTsv(text: string): AdditionLedgerRow[] {
  return [...tsvRows(text, LEDGER_COLUMNS, ADDITIONS_LEDGER_FILE)]
    .map((cells) => rowFrom(LEDGER_COLUMNS, cells));
}

function compareBigIntStrings(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '') return -1;
  if (b === '') return 1;
  const ba = BigInt(a);
  const bb = BigInt(b);
  return ba < bb ? -1 : ba > bb ? 1 : 0;
}

export function serializeBindingReview(rows: readonly BindingReviewRow[]): string {
  const lines = [...rows]
    .sort((a, b) => compareBigIntStrings(a.gaia_source_id, b.gaia_source_id))
    .map((r) => BINDING_REVIEW_COLUMNS.map((c) => r[c]).join('\t'));
  return `${[BINDING_REVIEW_COLUMNS.join('\t'), ...lines].join('\n')}\n`;
}

function oneOf<T extends string>(
  value: string, allowed: readonly T[], what: string, label: string,
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`${label}: ${what} "${value}" is not one of ${allowed.join(' | ')}`);
  }
  return value as T;
}

export function parseBindingDispositionsTsv(text: string): Map<string, BindingDispositionRow> {
  const out = new Map<string, BindingDispositionRow>();
  for (const [gaia_source_id, disposition, basis, evidence] of tsvRows(
    text, BINDING_DISPOSITION_COLUMNS, BINDING_DISPOSITIONS_FILE,
  )) {
    if (!/^\d+$/.test(gaia_source_id)) {
      throw new Error(`${BINDING_DISPOSITIONS_FILE}: gaia_source_id "${gaia_source_id}" is not an integer`);
    }
    if (out.has(gaia_source_id)) {
      throw new Error(`${BINDING_DISPOSITIONS_FILE}: duplicate gaia_source_id ${gaia_source_id}`);
    }
    if (evidence.trim() === '') {
      throw new Error(`${BINDING_DISPOSITIONS_FILE}: row ${gaia_source_id} states no evidence`);
    }
    out.set(gaia_source_id, {
      gaia_source_id,
      disposition: oneOf(disposition, BINDING_DISPOSITIONS, 'disposition', BINDING_DISPOSITIONS_FILE),
      basis: oneOf(basis, BINDING_DISPOSITION_BASES, 'basis', BINDING_DISPOSITIONS_FILE),
      evidence,
    });
  }
  return out;
}

export function serializeLabelDrops(rows: readonly LabelDropRow[]): string {
  const lines = rows.map((r) => LABEL_DROP_COLUMNS.map((c) => r[c]).join('\t')).sort();
  return `${[LABEL_DROP_COLUMNS.join('\t'), ...lines].join('\n')}\n`;
}

export function parseLabelDropsTsv(text: string): LabelDropRow[] {
  return [...tsvRows(text, LABEL_DROP_COLUMNS, LABEL_DROPS_FILE)].map((cells) => {
    const row = rowFrom(LABEL_DROP_COLUMNS, cells);
    oneOf(row.reason, LABEL_DROP_REASONS, 'reason', LABEL_DROPS_FILE);
    return row;
  });
}

/** The identifier tuple a ledger row and a manifest row share — the same five
 *  cells the parked ledger keys on. */
export function manifestKey(
  row: Pick<ManifestRow, 'tyc' | 'hip' | 'hd' | 'gl' | 'gaia_source_id'>,
): string {
  return parkedRecordKey(row);
}

// ---- designations ------------------------------------------------------------

/** The `starDesignations` set a manifest row stands in for — the membership
 *  term's half of SID resolution once the build reads this file. */
export function manifestDesignations(row: ManifestRow): string[] {
  return starDesignations({
    isSol: row.proper === SOL_PROPER_NAME,
    hip: parseIntOrNull(row.hip),
    hd: parseIntOrNull(row.hd),
    hr: parseIntOrNull(row.hr),
    hdAlt: splitValues(row.hd_alt).map(Number),
    hrAlt: splitValues(row.hr_alt).map(Number),
    gl: row.gl === '' ? null : row.gl,
    gaiaSourceId: row.gaia_source_id === '' ? null : row.gaia_source_id,
    syntheticId: null,
  });
}

/** Rows in SID canonical-key order, then TYC, then source — a total order over
 *  committed inputs, so a regeneration diffs by content and never by walk order. */
export function sortManifestRows(rows: readonly ManifestRow[]): ManifestRow[] {
  return rows
    .map((row) => ({ row, key: canonicalKeyOf(manifestDesignations(row)) }))
    .sort((a, b) => compareDesignations(a.key, b.key)
      || (a.row.tyc < b.row.tyc ? -1 : a.row.tyc > b.row.tyc ? 1 : 0)
      || compareBigIntStrings(a.row.gaia_source_id, b.row.gaia_source_id))
    .map((d) => d.row);
}

// ---- the spine side ----------------------------------------------------------

/** Every designation a record already answers to, in the forms an addition's
 *  cells compare on. An addition may take none of them: a designation on two
 *  records names a granularity and keys no SID (docs/sid.md § 4.1), so
 *  attaching one another record holds would cost that record its key — the
 *  collision guard's rule, applied at admission.
 *
 *  Seeded from the spine after the label merge and grown as each addition is
 *  admitted, so two addition groups cannot take one designation either. */
interface Claims {
  hd: Set<number>;
  hr: Set<number>;
  hip: Set<number>;
  /** Keyed by `normaliseGjKey` form (number + component letter); the value is
   *  the claiming record's own designation, which is what a component row has
   *  to name. */
  gl: Map<string, string>;
  /** The spine's alone, and it needs no sequential growth: `sharedSources`
   *  drops any raw source two addition groups reach, so no admitted row can
   *  take a source another group would have. */
  gaia: Set<string>;
}

/** The `gl:` designation a record answers to — `starDesignations`' form, which
 *  is the raw cell and not the normalised key. */
function glDesignation(cell: string): string {
  return `gl:${cell.trim().replace(/\s+/g, '_')}`;
}

/** The designation of the record already answering to this GJ key, or null.
 *  Matched on the normalised key alone, letter included: `GJ 3131B` is the
 *  other component of `GJ 3131A`'s pair, a second star under a second
 *  designation, and blocking it would drop a record rather than protect a key.
 *  Whether the system is already represented at all is the cohort filter's
 *  question, and `spineKeys` answers it against the bare number there. */
function claimedGl(claims: Claims, key: string): string | null {
  return claims.gl.get(key) ?? null;
}

function claimRecord(claims: Claims, r: LabelMergeRecord): void {
  if (r.hd !== null) claims.hd.add(r.hd);
  for (const hd of r.hdAlt) claims.hd.add(hd);
  if (r.hr !== null) claims.hr.add(r.hr);
  for (const hr of r.hrAlt) claims.hr.add(hr);
  if (r.hip !== null) claims.hip.add(r.hip);
  const gl = normaliseGjKey(r.gl);
  if (gl !== null && r.gl !== null) claims.gl.set(gl, glDesignation(r.gl));
}

function spineClaims(records: readonly LabelMergeRecord[]): Claims {
  const claims: Claims = {
    hd: new Set(), hr: new Set(), hip: new Set(), gl: new Map(), gaia: new Set(),
  };
  for (const r of records) {
    claimRecord(claims, r);
    if (r.gaiaSourceId !== null) claims.gaia.add(r.gaiaSourceId);
  }
  return claims;
}

function bindingFor(check: IdentityCheck): { binding: BindingClass; keep: boolean } {
  if (check.spine === null || check.verdict === 'sol') return { binding: 'none', keep: false };
  if (check.verdict === 'agree') return { binding: 'crosswalk_gated', keep: true };
  if (check.simbad === 'corroborates') return { binding: 'simbad_corroborated', keep: true };
  return { binding: 'none', keep: false };
}

function bindingReviewRow(
  row: SpineRow, check: IdentityCheck, tables: PrimaryTables,
): BindingReviewRow {
  const xids = tables.simbadBySourceId.get(check.spine ?? '');
  return {
    tyc: row.tyc, hip: row.hip, hd: row.hd, hr: row.hr, gl: row.gl,
    gaia_source_id: check.spine ?? '',
    verdict: check.verdict,
    via_tyc: check.viaTyc ?? '', via_hip: check.viaHip ?? '', via_cns5: check.viaCns5 ?? '',
    simbad: check.simbad ?? '',
    simbad_hip: xids?.hip == null ? '' : String(xids.hip),
    simbad_tyc: xids?.tyc ?? '',
    simbad_gj: xids?.gj ?? '',
  };
}

/** Empty the spine-label cells no primary attests — the Flamsteed number, and
 *  the HD number with its aliases — into § 6.2 ledger rows keyed on the row as
 *  it stands afterwards, so each joins the manifest row it left. Returns the
 *  attestation of the row it leaves behind, which is the one `routesCell`
 *  needs: the HD drop runs first because IV/27A can publish a Flamsteed number
 *  against an HD no HD primary attests. */
function dropUnattestedLabels(
  row: ManifestRow, tables: PrimaryTables, idx: PrimaryIndex, into: LabelDropRow[],
): RowAttestation {
  const dropped: Array<{ cell: 'hd' | 'flam'; value: string; reason: LabelDropReason }> = [];
  const hds = [row.hd, ...splitValues(row.hd_alt)].filter((h) => h !== '');
  const kept = hds.filter((h) => {
    const hd = parseIntOrNull(h);
    if (hd !== null && attestHd(hd, idx, tables) !== null) return true;
    dropped.push({ cell: 'hd', value: h, reason: 'hd_unattested' });
    return false;
  });
  row.hd = kept[0] ?? '';
  row.hd_alt = joinValues(kept.slice(1));
  let attestation = attestSpineRow(row, tables, idx);
  if (row.flam !== '' && attestation.attestation.flam === null) {
    dropped.push({ cell: 'flam', value: row.flam, reason: 'flamsteed_unattested' });
    row.flam = '';
    attestation = attestSpineRow(row, tables, idx);
  }
  for (const d of dropped) {
    into.push({
      tyc: row.tyc, hip: row.hip, hd: row.hd, gl: row.gl, gaia_source_id: row.gaia_source_id,
      cell: d.cell, value: d.value, reason: d.reason,
    });
  }
  return attestation;
}

function routesCell(a: RowAttestation): {
  routes: string; unattested: ClassicalCell[];
} {
  const routes: string[] = [];
  for (const cell of CLASSICAL_CELLS) {
    const by = a.attestation[cell];
    if (by !== null) routes.push(`${cell}:${by}`);
  }
  if (a.attestation.tyc !== null) routes.push('tyc:tycho2');
  return { routes: joinValues(routes), unattested: a.unattested };
}

function intCell(v: number | null): string {
  return v === null ? '' : String(v);
}

function manifestRowFromRecord(
  cells: { tyc: string; bayer: string; proper: string },
  r: LabelMergeRecord,
  binding: BindingClass,
): ManifestRow {
  return {
    tyc: cells.tyc,
    hip: intCell(r.hip),
    hd: intCell(r.hd),
    hd_alt: joinValues(r.hdAlt),
    hr: intCell(r.hr),
    hr_alt: joinValues(r.hrAlt),
    gl: r.gl ?? '',
    flam: intCell(r.flam),
    bayer: cells.bayer,
    proper: cells.proper,
    gaia_source_id: r.gaiaSourceId ?? '',
    binding,
    routes: '',
  };
}

// ---- the additions -----------------------------------------------------------

/** One primary's row the spine lacks, before the cohorts are merged: the same
 *  star reaches this list once per primary that names it. */
interface AdditionItem {
  key: string;
  hd: HdAddition | null;
  hip: HipAddition | null;
  cns5: Cns5Row | null;
  rawSource: string | null;
}

/** Designation-keyed indexes over the primaries the additions join through. */
interface AdditionIndex {
  hrByHd: Map<number, number[]>;
  hipByHdIv27a: Map<number, number[]>;
  flamByHd: Map<number, number>;
  flamByHip: Map<number, number>;
}

function indexAdditions(tables: PrimaryTables): AdditionIndex {
  const hrByHd = new Map<number, number[]>();
  for (const r of tables.v50) {
    if (r.hd === null) continue;
    pushKeyed(hrByHd, r.hd, r.hr);
  }
  const hipByHdIv27a = new Map<number, number[]>();
  const flamByHd = new Map<number, number>();
  const flamByHip = new Map<number, number>();
  for (const r of tables.iv27a) {
    if (r.hip !== null) pushKeyed(hipByHdIv27a, r.hd, r.hip);
    if (r.flamsteed === null) continue;
    if (!flamByHd.has(r.hd)) flamByHd.set(r.hd, r.flamsteed);
    if (r.hip !== null && !flamByHip.has(r.hip)) flamByHip.set(r.hip, r.flamsteed);
  }
  return { hrByHd, hipByHdIv27a, flamByHd, flamByHip };
}

/** Merge the three cohorts into one group per star: an HD item joins the HIP
 *  item Tycho-2's own `hip` column (or IV/27A) names for it, and items naming
 *  one raw source are one star — except two TYC items, which are two Tycho-2
 *  stars whatever the best-neighbour walk says, and take no side. */
function groupAdditions(
  items: readonly AdditionItem[],
  tables: PrimaryTables,
  index: AdditionIndex,
): AdditionItem[][] {
  const uf = new UnionFind();
  const byKey = new Map(items.map((i) => [i.key, i]));
  for (const i of items) uf.add(i.key);
  const hipKey = (hip: number): string => `hip:${hip}`;
  for (const i of items) {
    if (i.hd === null) continue;
    const tycho2Hip = tables.tycho2.get(i.hd.tyc)?.hip ?? null;
    const linked = tycho2Hip === null ? [] : [tycho2Hip];
    for (const hd of i.hd.hds) linked.push(...(index.hipByHdIv27a.get(hd) ?? []));
    for (const hip of linked) {
      if (byKey.has(hipKey(hip))) uf.union(i.key, hipKey(hip));
    }
  }
  const bySource = new Map<string, AdditionItem[]>();
  for (const i of items) {
    if (i.rawSource === null) continue;
    pushKeyed(bySource, i.rawSource, i);
  }
  for (const list of bySource.values()) {
    const tycItems = list.filter((i) => i.hd !== null);
    const rest = list.filter((i) => i.hd === null);
    const anchor = tycItems.length === 1 ? tycItems[0] : rest[0];
    if (anchor === undefined) continue;
    for (const i of rest) uf.union(anchor.key, i.key);
  }
  const groups = new Map<string, AdditionItem[]>();
  for (const i of items) pushKeyed(groups, uf.find(i.key), i);
  return [...groups.values()];
}

/** One star's items merged across the primaries, with the § 4 gate's verdict on
 *  the source they reach. Everything admission needs except the claim set,
 *  which grows under it — so these are resolved before the first group is
 *  admitted and fix the order the contested designations go in. */
interface AdditionGroup {
  hd: HdAddition | null;
  hip: HipAddition | null;
  cns5: Cns5Row | null;
  rawGl: string | null;
  tyc: string;
  source: string | null;
  sourceOnSpine: boolean;
  sourceGateRefused: boolean;
  routeSourceDisagree: boolean;
}

function additionGroup(
  items: readonly AdditionItem[],
  claims: Claims,
  tables: PrimaryTables,
  overlay: ClassicIdOverlay,
  sharedSources: ReadonlySet<string>,
): AdditionGroup {
  // One item per cohort is what the grouping rules produce and what admission
  // reads; a second would leave a primary's row in no manifest row and on no
  // ledger line, which § 6.1 forbids outright. Loud beats silent: the shape is
  // new, and what it should admit is a decision, not a default.
  for (const cohort of ['hd', 'hip', 'cns5'] as const) {
    const named = items.filter((i) => i[cohort] !== null);
    if (named.length > 1) {
      throw new Error(
        `addition group holds ${named.length} ${cohort} items (${named.map((i) => i.key).join(', ')}); `
          + 'groupAdditions merges one star\'s items, so admission drops all but the first',
      );
    }
  }
  const hd = items.find((i) => i.hd !== null)?.hd ?? null;
  const hip = items.find((i) => i.hip !== null)?.hip ?? null;
  const cns5 = items.find((i) => i.cns5 !== null)?.cns5 ?? null;

  const tycSource = hd === null ? null : tables.tycToSource.get(hd.tyc) ?? null;
  const hipSource = hip?.gaiaSourceId ?? null;
  const rawSource = tycSource ?? hipSource ?? cns5?.gaiaSourceId ?? null;
  const sourceOnSpine = rawSource !== null && claims.gaia.has(rawSource);
  const sourceGateRefused = rawSource !== null && !sourceOnSpine && !overlay.has(rawSource);
  return {
    hd, hip, cns5,
    rawGl: cns5 === null ? null : `GJ ${cns5.gj}${cns5.gjComp ?? ''}`,
    tyc: hd?.tyc ?? '',
    source: rawSource !== null && !sourceOnSpine && !sourceGateRefused
      && !sharedSources.has(rawSource)
      ? rawSource
      : null,
    sourceOnSpine,
    sourceGateRefused,
    routeSourceDisagree: tycSource !== null && hipSource !== null && tycSource !== hipSource,
  };
}

/** Two groups can arrive with the same designation and no spine record to lose
 *  it to — IV/25 resolving one HD onto two Tycho-2 stars is the shape, and it
 *  flags them `n_tyc > 1`. Admission is sequential, so this order decides which
 *  one takes the designation and which ledgers onto it as a component: the
 *  group whose Gaia binding survives the § 4 gate first, since the other
 *  component would otherwise park for want of a parallax this one has, then by
 *  TYC, HIP and GJ — a total order over content, never over walk order. */
function compareAdditionGroups(a: AdditionGroup, b: AdditionGroup): number {
  const bound = Number(a.source === null) - Number(b.source === null);
  if (bound !== 0) return bound;
  if (a.tyc !== b.tyc) return a.tyc < b.tyc ? -1 : 1;
  const hipA = a.hip?.hip ?? 0;
  const hipB = b.hip?.hip ?? 0;
  if (hipA !== hipB) return hipA - hipB;
  const glA = a.rawGl ?? '';
  const glB = b.rawGl ?? '';
  return glA < glB ? -1 : glA > glB ? 1 : 0;
}

interface Admission {
  row: ManifestRow | null;
  /** The admitted row's record, for the claim set — null on a component row. */
  record: LabelMergeRecord | null;
  ledger: AdditionLedgerRow;
  /** Designations the guard withheld. Every one on a component row; on an
   *  admitted row it is a designation the primaries publish for this star that
   *  the record ships without, so the count is pinned. */
  blocked: readonly string[];
}

function admitGroup(
  group: AdditionGroup,
  claims: Claims,
  index: AdditionIndex,
): Admission {
  const { hd: hdItem, hip: hipItem, rawGl, tyc, source } = group;
  const blocked: string[] = [];

  const hds = [...(hdItem?.hds ?? [])].sort((a, b) => a - b).filter((hd) => {
    if (!claims.hd.has(hd)) return true;
    blocked.push(`hd:${hd}`);
    return false;
  });
  let hip: number | null = hipItem?.hip ?? null;
  if (hip !== null && claims.hip.has(hip)) {
    blocked.push(`hip:${hip}`);
    hip = null;
  }
  const hrs: number[] = [];
  for (const hd of hds) {
    for (const hr of index.hrByHd.get(hd) ?? []) {
      if (claims.hr.has(hr)) blocked.push(`hr:${hr}`);
      else if (!hrs.includes(hr)) hrs.push(hr);
    }
  }
  hrs.sort((a, b) => a - b);
  let gl = rawGl;
  const glKey = normaliseGjKey(gl);
  if (glKey !== null) {
    const held = claimedGl(claims, glKey);
    if (held !== null) {
      blocked.push(held);
      gl = null;
    }
  }
  let flam: number | null = null;
  for (const hd of hds) flam ??= index.flamByHd.get(hd) ?? null;
  if (hip !== null) flam ??= index.flamByHip.get(hip) ?? null;

  if (hds.length === 0 && hip === null && gl === null) {
    // Ledgered under the designations it arrived with; the first blocked one
    // in ladder order names the record it resolves onto.
    return {
      row: null,
      record: null,
      blocked,
      ledger: {
        tyc,
        hip: intCell(hipItem?.hip ?? null),
        hd: intCell(hdItem === null ? null : Math.min(...hdItem.hds)),
        gl: rawGl ?? '',
        gaia_source_id: '',
        reason: `${COMPONENT_REASON_PREFIX}${blocked.sort(compareDesignations)[0]}`,
      },
    };
  }
  const reason: AdditionReason = hds.length > 0
    ? (hds[0] < ATHYG_HD_LINK_FLOOR ? 'admitted:hd_link_gap' : 'admitted:hd_omitted')
    : hip !== null ? 'admitted:hip_omitted' : 'admitted:cns5_census';
  const record: LabelMergeRecord = {
    gaiaSourceId: source,
    hip, hd: hds[0] ?? null, hr: hrs[0] ?? null, gl, flam,
    hdAlt: hds.slice(1), hrAlt: hrs.slice(1),
  };
  const row = manifestRowFromRecord(
    { tyc, bayer: '', proper: '' }, record, source === null ? 'none' : 'crosswalk_gated',
  );
  return {
    row,
    record,
    blocked,
    ledger: {
      tyc, hip: row.hip, hd: row.hd, gl: row.gl, gaia_source_id: row.gaia_source_id, reason,
    },
  };
}

// ---- the build -----------------------------------------------------------------

export function buildMembership(input: MembershipInput): MembershipResult {
  const { spine, tables, overlay, overrides, siblingRenderedSourceIds, dispositions } = input;
  const idx = indexPrimaries(tables);

  const spineSides = spine.map(spineLabelMergeRecord);
  const records = spineSides.map((s) => s.record);
  const merge = mergeClassicIdLabels({
    records,
    labels: spineSides.map((s) => s.label),
    overlay,
    overrides,
    siblingRenderedSourceIds,
  });

  const bindingByClass: Record<BindingClass, number> = {
    crosswalk_gated: 0, simbad_corroborated: 0, reviewed: 0, none: 0,
  };
  const unattestedByCell = Object.fromEntries(
    CLASSICAL_CELLS.map((c) => [c, 0]),
  ) as Record<ClassicalCell, number>;
  const bindingReview: BindingReviewRow[] = [];
  const labelDrops: LabelDropRow[] = [];
  const rows: ManifestRow[] = [];
  const attest = (row: ManifestRow, a?: RowAttestation): void => {
    const { routes, unattested } = routesCell(a ?? attestSpineRow(row, tables, idx));
    row.routes = routes;
    for (const cell of unattested) unattestedByCell[cell]++;
    bindingByClass[row.binding as BindingClass]++;
    rows.push(row);
  };

  spine.forEach((spineRow, i) => {
    const check = checkIdentity(spineRow, tables, idx);
    let { binding, keep } = bindingFor(check);
    if (!keep && check.spine !== null && check.verdict !== 'sol') {
      bindingReview.push(bindingReviewRow(spineRow, check, tables));
      if (dispositions.get(check.spine)?.disposition === 'keep') {
        binding = 'reviewed';
        keep = true;
      }
    }
    const record = records[i];
    if (!keep) record.gaiaSourceId = null;
    const row = manifestRowFromRecord(spineRow, record, binding);
    attest(row, dropUnattestedLabels(row, tables, idx, labelDrops));
  });

  const claims = spineClaims(records);
  const additions = findAdditions(tables, spineKeys(spine), idx);
  const items: AdditionItem[] = [
    ...additions.hd.map((hd) => ({
      key: `tyc:${hd.tyc}`, hd, hip: null, cns5: null,
      rawSource: tables.tycToSource.get(hd.tyc) ?? null,
    })),
    ...additions.hip.map((hip) => ({
      key: `hip:${hip.hip}`, hd: null, hip, cns5: null, rawSource: hip.gaiaSourceId,
    })),
    ...additions.cns5.newRecords.map((cns5) => ({
      key: `cns5:${cns5.cns5}`, hd: null, hip: null, cns5, rawSource: cns5.gaiaSourceId,
    })),
  ];
  const index = indexAdditions(tables);
  const itemGroups = groupAdditions(items, tables, index);
  const sourceGroups = new Map<string, number>();
  for (const g of itemGroups) {
    const sources = new Set(g.map((i) => i.rawSource).filter((s): s is string => s !== null));
    for (const s of sources) sourceGroups.set(s, (sourceGroups.get(s) ?? 0) + 1);
  }
  const sharedSources = new Set([...sourceGroups].filter(([, n]) => n > 1).map(([s]) => s));
  const groups = itemGroups
    .map((g) => additionGroup(g, claims, tables, overlay, sharedSources))
    .sort(compareAdditionGroups);

  const ledger: AdditionLedgerRow[] = [];
  const additionsByReason = Object.fromEntries(
    ADDITION_REASONS.map((r) => [r, 0]),
  ) as Record<AdditionReason, number>;
  let componentRows = 0;
  let additionSourceOnSpine = 0;
  let additionSourceGateRefused = 0;
  let additionRouteSourceDisagree = 0;
  let additionGaiaKeyedOnly = 0;
  let additionsWithBlockedDesignation = 0;
  for (const g of groups) {
    const a = admitGroup(g, claims, index);
    if (g.sourceOnSpine) additionSourceOnSpine++;
    if (g.sourceGateRefused) additionSourceGateRefused++;
    if (g.routeSourceDisagree) additionRouteSourceDisagree++;
    ledger.push(a.ledger);
    if (a.row === null || a.record === null) {
      componentRows++;
      continue;
    }
    additionsByReason[a.ledger.reason as AdditionReason]++;
    if (a.blocked.length > 0) additionsWithBlockedDesignation++;
    const designations = manifestDesignations(a.row);
    if (designations.length === 1 && designations[0].startsWith('gaia_dr3:')) additionGaiaKeyedOnly++;
    claimRecord(claims, a.record);
    attest(a.row);
  }

  const sorted = sortManifestRows(rows);
  const owners = new Map<string, number>();
  for (const row of sorted) {
    for (const d of new Set(manifestDesignations(row))) owners.set(d, (owners.get(d) ?? 0) + 1);
  }
  const counts: MembershipCounts = {
    ...merge.counts,
    rows: sorted.length,
    spineRows: spine.length,
    additionRows: sorted.length - spine.length,
    additionsByReason,
    componentRows,
    bindingByClass,
    bindingReviewRows: bindingReview.length,
    labelDropsByReason: Object.fromEntries(LABEL_DROP_REASONS.map(
      (reason) => [reason, labelDrops.filter((d) => d.reason === reason).length],
    )) as Record<LabelDropReason, number>,
    unattestedByCell,
    additionSourceOnSpine,
    additionSourceGateRefused,
    additionSourceShared: sharedSources.size,
    additionGaiaKeyedOnly,
    additionRouteSourceDisagree,
    additionsWithBlockedDesignation,
    sharedDesignations: [...owners.values()].filter((n) => n > 1).length,
    rowsWithHdAlt: sorted.filter((r) => r.hd_alt !== '').length,
    rowsWithHrAlt: sorted.filter((r) => r.hr_alt !== '').length,
  };
  return { rows: sorted, ledger, bindingReview, labelDrops, flips: merge.flips, counts };
}

// ---- the parity gate's matcher -----------------------------------------------

export interface SpineMatch {
  /** Per spine row: the index of the one manifest row its designation class
   *  reaches, or null. */
  manifestIndex: (number | null)[];
  /** Spine rows none of whose designations the manifest knows. */
  unmatched: number[];
  /** Spine rows whose canonical key's class holds more than one manifest row —
   *  a stored bridge joining two records. */
  multiple: number[];
  /** Manifest rows no spine row reaches — the additions. */
  unreached: number[];
}

/** Resolve every spine row through the manifest's designation classes the way
 *  `sid:allocate` resolves a record: the same-as graph over each manifest row's
 *  designations plus the stored bridges, a designation on more than one
 *  manifest row dropped first (docs/sid.md § 4.1), and the row keyed on its
 *  first ladder-ranked designation the graph knows — its canonical key. A
 *  lower-ranked designation the label merge moved to a sibling therefore does
 *  not split the match: the SID never rode on it. */
export function matchSpineToManifest(
  spineDesignations: readonly (readonly string[])[],
  manifestRows: readonly ManifestRow[],
  storedEdges: readonly SameasEdge[],
): SpineMatch {
  const owners = new Map<string, number>();
  const manifestSets = manifestRows.map(manifestDesignations);
  for (const set of manifestSets) {
    for (const d of new Set(set)) owners.set(d, (owners.get(d) ?? 0) + 1);
  }
  const uf = new UnionFind();
  const rowByDesignation = new Map<string, number>();
  manifestSets.forEach((set, i) => {
    const kept = set.filter((d) => owners.get(d) === 1);
    for (const d of kept) {
      uf.add(d);
      rowByDesignation.set(d, i);
    }
    for (let k = 1; k < kept.length; k++) uf.union(kept[0], kept[k]);
  });
  const endpoints = new Set<string>();
  for (const e of storedEdges) {
    uf.add(e.a);
    uf.add(e.b);
    uf.union(e.a, e.b);
    endpoints.add(e.a);
    endpoints.add(e.b);
  }
  const rowsByRoot = new Map<string, Set<number>>();
  for (const [d, i] of rowByDesignation) {
    const root = uf.find(d);
    const set = rowsByRoot.get(root) ?? new Set<number>();
    set.add(i);
    rowsByRoot.set(root, set);
  }
  const manifestIndex: (number | null)[] = [];
  const unmatched: number[] = [];
  const multiple: number[] = [];
  const reached = new Set<number>();
  spineDesignations.forEach((set, s) => {
    const key = [...set].sort(compareDesignations)
      .find((d) => rowByDesignation.has(d) || endpoints.has(d));
    const hits = key === undefined ? new Set<number>() : rowsByRoot.get(uf.find(key)) ?? new Set<number>();
    if (hits.size === 1) {
      const [i] = hits;
      manifestIndex.push(i);
      reached.add(i);
    } else {
      manifestIndex.push(null);
      (hits.size === 0 ? unmatched : multiple).push(s);
    }
  });
  const unreached = manifestRows.map((_, i) => i).filter((i) => !reached.has(i));
  return { manifestIndex, unmatched, multiple, unreached };
}

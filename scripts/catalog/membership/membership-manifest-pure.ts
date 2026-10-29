// The primaries-derived membership manifest: row assembly from the spine plus
// the primaries' additions, the two ledgers, the TSV codecs, and the
// spine ↔ manifest matcher the parity gate runs. Contract: /docs/catalog-driver.md#31-retiring-the-spine--the-membership-rule-measured-against-the-primaries.

import { SOL_APPARENT_V_MAGNITUDE, SOL_PROPER_NAME, normaliseGjKey } from '../record/catalog-pure';
import type { Cns5Row } from '../classic-ids/classic-ids-parse';
import type { Declared } from '../../util/sources/source';
import {
  BRIGHT_TIER_MAG_CEILING,
  type ClassicIdOverlay,
} from '../classic-ids/classic-id-overlay-pure';
import type {
  BindingEvidence, GateReason, SimbadWdsXidIndex, WdsComponentAttribution,
} from './binding/binding-gate-pure';
import {
  BINDING_SOURCES,
  bindingCandidates,
  deriveBinding,
  indexSimbadSources,
  rowGateEvidence,
  type BindingCells,
  type BindingSource,
  type DerivedBinding,
  type RankedCandidate,
  type RowGateEvidence,
} from './binding/binding-derivation-pure';
import {
  mergeClassicIdLabels,
  spineLabelMergeRecord,
  type LabelMergeCounts,
  type LabelMergeRecord,
  type LabelOverrides,
} from '../classic-ids/label-merge/label-merge-pure';
import { parkedRecordKey } from '../distance/parallax/parked-ledger';
import { intCell, readTable } from '../../util/tsv/table-pure';
import { nullableCell } from '../../util/tsv/artifact-pure';
import { applyCellSets, evidenceOf } from '../../util/tsv/cell-corrections-pure';
import { ADDITION_REASONS, type AdditionReason } from './ledger-rows-pure';
import { BINDING_REVIEW_KEY_COLUMNS, BINDING_REVIEW_VERDICTS, bindingReviewKey, type BindingReviewVerdict } from './ledger-rows-pure';
import { LABEL_DROP_REASONS, type LabelDropReason } from './ledger-rows-pure';
import type { IdentityRow } from '../lineage/identity-pure';
import type { LineageRow } from '../lineage/lineage-row-pure';
import {
  membershipLedgers,
  membershipLineageRow,
  type AdditionBindingOutcome,
  type BindingReviewCells,
  type KeyedOutcome,
  type MembershipLedgers,
  type MembershipOutcome,
} from './membership-lineage-pure';
import { spineDesignations, type SpineRow } from '../spine/inherited-spine-pure';
import {
  ATHYG_HD_LINK_FLOOR,
  CLASSICAL_CELLS,
  attestHd,
  attestSpineRow,
  findAdditions,
  indexPrimaries,
  spineKeys,
  type ClassicalCell,
  type HdAddition,
  type HipAddition,
  type PrimaryIndex,
  type PrimaryTables,
  type RowAttestation,
} from '../spine/primaries-audit-pure';
import type { SimbadXids } from '../spectral/spectral-resolve';
import {
  UnionFind,
  compareDesignations,
  type SameasEdge,
} from '../../sid/sid-pure';
import {
  BINDING_CLASSES,
  MANIFEST_VALUE_SEPARATOR,
  MEMBERSHIP_MANIFEST,
  manifestDesignations,
  manifestRecord,
  sortManifestRecords,
  type BindingClass,
  type ManifestColumn,
  type ManifestRecord,
} from './membership-manifest-tsv';
import {
  magnitudeTermNewcomers,
  type MagnitudeTermCounts,
  type MagnitudeTermSelection,
} from './magnitude-term/magnitude-term-pure';

export const MEMBERSHIP_EXPECTED_FILE =
  'scripts/catalog/membership/membership-manifest-expected.json';

/** A manifest row as the generator assembles it, cell by cell, before
 *  `manifestRecord` types it. */
type ManifestCells = Record<ManifestColumn, string>;

/** See binding/README.md. */
export const BINDING_OUTCOMES = [
  'bound', 'refused', 'contested', 'collision', 'sol',
] as const;
export type BindingOutcome = (typeof BINDING_OUTCOMES)[number];

export const BINDING_DISPOSITION_COLUMNS = [
  ...BINDING_REVIEW_KEY_COLUMNS, 'derived_source_id',
  'keep_source_id', 'basis', 'evidence',
] as const;
/** Which value a disposition settled on, for the count snapshot. */
export const BINDING_DISPOSITIONS = ['derived', 'other', 'none'] as const;
export type BindingDisposition = (typeof BINDING_DISPOSITIONS)[number];
/** What a disposition rests on: the record's own Tycho-2 position against the
 *  Gaia source; V/70A's position and proper motion against it; SIMBAD's object
 *  under the id in the Gaia DR2 namespace carrying the record's designation;
 *  Gaia's G against the record's printed V on both candidates; a resolved
 *  pair's components bound crosswise, the WDS component letters deciding;
 *  one Gaia source two records reach, held by the one whose light it is. */
export const BINDING_DISPOSITION_BASES = [
  'tycho2_position', 'v70a_astrometry', 'simbad_dr2_object',
  'gaia_photometry', 'pair_component', 'shared_source',
] as const;
export type BindingDispositionBasis = (typeof BINDING_DISPOSITION_BASES)[number];
export type BindingDispositionRow = Record<(typeof BINDING_DISPOSITION_COLUMNS)[number], string> & {
  basis: BindingDispositionBasis;
};

export function dispositionOf(d: BindingDispositionRow): BindingDisposition {
  if (d.keep_source_id === '') return 'none';
  if (d.keep_source_id === d.derived_source_id) return 'derived';
  return 'other';
}

/** The corrections file as its own messages name it. */
const SPINE_CORRECTIONS_NAME = 'spine-corrections.tsv';
export const SPINE_CORRECTION_COLUMNS = [
  ...BINDING_REVIEW_KEY_COLUMNS, 'op', 'cell', 'value', 'evidence',
] as const;
/** `set` replaces one cell; `fold` says the row is another spine row's
 *  duplicate and `value` is that row's key. */
export const SPINE_CORRECTION_OPS = ['set', 'fold'] as const;
export type SpineCorrectionOp = (typeof SPINE_CORRECTION_OPS)[number];
/** `tyc` alone — a curated exception to a LABEL belongs in
 *  `classic_id_overrides.tsv`, where the merge can see it. */
export const SPINE_CORRECTION_CELLS = ['tyc'] as const;
export type SpineCorrectionCell = (typeof SPINE_CORRECTION_CELLS)[number];
export type SpineCorrectionRow = Record<
  (typeof SPINE_CORRECTION_COLUMNS)[number], string
> & { op: SpineCorrectionOp };

export function parseSpineCorrectionsTsv(text: string, from: Declared): SpineCorrectionRow[] {
  const out: SpineCorrectionRow[] = [];
  for (const row of readTable({ ...from, columns: SPINE_CORRECTION_COLUMNS, comments: true }, text)) {
    const cells = row.cells();
    const op = row.oneOf('op', SPINE_CORRECTION_OPS);
    if (op === 'set' && !(SPINE_CORRECTION_CELLS as readonly string[]).includes(cells.cell)) {
      row.fail(
        `set may write ${SPINE_CORRECTION_CELLS.join(', ')}, not "${cells.cell}" — `
          + 'a label exception belongs in classic_id_overrides.tsv',
      );
    }
    if (BINDING_REVIEW_KEY_COLUMNS.every((c) => cells[c].trim() === '')) {
      row.fail(
        "row names no spine row — every key cell is empty, and the empty key is Sol's own, "
          + 'so a blank one corrects the Sun',
      );
    }
    evidenceOf(row, 'evidence', bindingReviewKey(cells));
    out.push({ ...cells, op });
  }
  return out;
}

/** One fold, in both index spaces: the two rows' positions in the committed
 *  spine, and the survivor's position among the rows that stay. The gate reads
 *  the first pair (it walks the file), the generator the first and third. */
export interface SpineFold {
  foldedRow: number;
  survivorRow: number;
  survivorKept: number;
}

/** The text form of each record's origin SourceRowRef (../lineage/README.md#identity--the-origin-source-row),
 *  built by the caller, which holds the declarations. */
export interface OriginKeys {
  /** By the row's index in the committed spine. */
  spine(index: number): string;
  iv25(tyc: string): string;
  i239(hip: number): string;
  cns5(id: number): string;
  gaia(sourceId: string): string;
}

/** The spine as the manifest reads it: AT-HYG's merge decisions with the ones
 *  review found wrong corrected, and the rows it carried twice folded onto
 *  their survivor. The spine file itself is frozen (`../spine/README.md`), so a
 *  correction is a committed, evidenced row here rather than an edit there.
 *
 *  `corrected` is every spine row with its cells fixed, in file order — the
 *  keys a disposition now joins on. `kept` drops the folded ones.
 *  `buildMembership` holds every folded row's designations against the
 *  surviving manifest row afterwards, so a fold that loses a designation fails
 *  rather than quietly shrinking the catalogue. */
export function applySpineCorrections(
  spine: readonly SpineRow[], corrections: readonly SpineCorrectionRow[],
): { corrected: SpineRow[]; kept: SpineRow[]; keptSpineIndex: number[]; folds: SpineFold[] } {
  const byKey = new Map<string, number>();
  spine.forEach((row, i) => byKey.set(bindingReviewKey(row), i));
  const resolve = (key: string, what: string): number => {
    const i = byKey.get(key);
    if (i === undefined) {
      throw new Error(`${SPINE_CORRECTIONS_NAME}: ${what} "${key}" matches no spine row`);
    }
    return i;
  };

  const rows = applyCellSets<SpineRow, SpineCorrectionCell>(
    spine,
    corrections.filter((c) => c.op === 'set')
      .map((c) => ({ key: bindingReviewKey(c), cell: c.cell as SpineCorrectionCell, value: c.value })),
    {
      file: SPINE_CORRECTIONS_NAME,
      target: 'spine',
      keyOf: bindingReviewKey,
      get: (row, cell) => row[cell],
      with: (row, cell, value) => ({ ...row, [cell]: value }),
    },
  );
  const foldedTo = new Map<number, number>();
  for (const c of corrections) {
    if (c.op !== 'fold') continue;
    const i = resolve(bindingReviewKey(c), 'row');
    const survivor = resolve(c.value, 'fold target');
    if (survivor === i) {
      throw new Error(`${SPINE_CORRECTIONS_NAME}: row ${bindingReviewKey(c)} folds onto itself`);
    }
    foldedTo.set(i, survivor);
  }
  for (const survivor of foldedTo.values()) {
    if (foldedTo.has(survivor)) {
      throw new Error(
        `${SPINE_CORRECTIONS_NAME}: a fold target is itself folded — fold both onto the survivor`,
      );
    }
  }

  const kept: SpineRow[] = [];
  const keptSpineIndex: number[] = [];
  const keptIndex = new Map<number, number>();
  rows.forEach((row, i) => {
    if (foldedTo.has(i)) return;
    keptIndex.set(i, kept.length);
    kept.push(row);
    keptSpineIndex.push(i);
  });
  const folds = [...foldedTo].map(([foldedRow, survivorRow]) => ({
    foldedRow, survivorRow, survivorKept: keptIndex.get(survivorRow)!,
  }));
  return { corrected: rows, kept, keptSpineIndex, folds };
}

/** One queue row: what the derivation reached, with everything
 *  the derivation weighed — every source's candidate, the gate rejections, the
 *  printed V and both candidates' G, and SIMBAD's cross-IDs for each. */

export interface MembershipInput {
  spine: readonly SpineRow[];
  tables: PrimaryTables;
  /** The committed post-gate overlay the spine side's label merge reads:
   *  `has(source)` is the HD-route gate's verdict (/docs/catalog-driver.md#4-how-hd-reaches-gaia). */
  overlay: ClassicIdOverlay;
  overrides: LabelOverrides;
  siblingRenderedSourceIds: ReadonlySet<string>;
  /** The binding gates' evidence — G per source, printed V per HIP, WDS
   *  component cross-IDs — for the derivation's candidates. */
  evidence: BindingEvidence;
  /** The committed dispositions of the binding review queue, by
   *  `bindingReviewKey`. */
  dispositions: ReadonlyMap<string, BindingDispositionRow>;
  /** The committed corrections to AT-HYG's merge decisions
   *  (README.md#correcting-a-merge-decision). */
  corrections: readonly SpineCorrectionRow[];
  /** `magnitude-term/README.md#the-union-dedupes-on-the-derived-binding`. */
  magnitudeTerm: MagnitudeTermSelection | null;
  /** Whether the pulled astrometry gives this source a parallax — what decides
   *  which of two groups contesting a designation ships (README.md#the-additions). */
  publishesGaiaParallax: (sourceId: string) => boolean;
  keys: OriginKeys;
}

export interface MembershipCounts extends LabelMergeCounts {
  rows: number;
  spineRows: number;
  additionRows: number;
  /** The pull partitioned by the floor, and what survives the dedupe. All zero
   *  while the floor is null. */
  magnitudeTerm: MagnitudeTermCounts;
  magnitudeRows: number;
  /** README.md#the-additions. */
  magnitudeRowsOwnCandidate: Record<OwnCandidateReason, number>;
  additionsByReason: Record<AdditionReason, number>;
  /** Groups a primary admits that resolve onto an existing record instead. */
  componentRows: number;
  bindingByClass: Record<BindingClass, number>;
  /** Spine rows in the review queue, all verdicts. */
  bindingReviewRows: number;
  bindingReviewByVerdict: Record<BindingReviewVerdict, number>;
  /** Rows a committed disposition settled, per outcome. */
  bindingDispositions: Record<BindingDisposition, number>;
  /** What the derivation reached, over every spine row. */
  derivationOutcome: Record<BindingOutcome, number>;
  /** The source leading the winning candidate on spine rows that derive one. */
  derivedVia: Record<BindingSource, number>;
  /** Winners two or more sources agreed on. */
  derivedConsensus: number;
  /** Disposed ids no committed source proposes, shipping on the review's
   *  cited basis alone. */
  dispositionAsserted: number;
  /** Candidates a gate refused, the winner's losing rivals included. */
  derivedRejected: Record<GateReason, number>;
  /** Spine rows with a candidate and no printed V to weigh it against. */
  derivedUngateable: number;
  /** Candidates weighed with no row in the astrometry pull. Pinned at zero —
   *  a missing G is a pass, so this is the request under-covering the
   *  derivation, and the fixable half of the two no-G counts. */
  derivedWeighedNoGMag: number;
  /** Candidates weighed on a pulled row publishing no G — unweighable by any
   *  request. */
  derivedWeighedNullGMag: number;
  /** Spine labels the manifest leaves out, per label-parity reason (/docs/catalog-driver.md#62-label-parity). */
  labelDropsByReason: Record<LabelDropReason, number>;
  /** Manifest cells no primary attests, per identifier. */
  unattestedByCell: Record<ClassicalCell, number>;
  /** Addition groups whose raw source is a spine record's, so the cell stays
   *  empty: Gaia fitted one source where Tycho-2 resolved two stars. */
  additionSourceOnSpine: number;
  /** Addition groups with candidates, every one of which a gate refused. */
  additionSourceGateRefused: number;
  /** Derived sources two or more addition groups reach; no group takes one. */
  additionSourceShared: number;
  /** Addition candidates weighed with no row in the astrometry pull — the
   *  `derivedWeighedNoGMag` pin, over every derivation the additions run: each
   *  item's, which decides the grouping, and each merged group's. */
  additionWeighedNoGMag: number;
  /** Addition groups whose winner has a gate-passing runner-up. */
  additionContested: number;
  /** Admitted rows whose only designation is the Gaia id — the mints
   *  `sid:allocate` would key `gaia_dr3:`. Zero by construction, since a group
   *  with no classical designation left is ledgered rather than admitted; the
   *  pin is the tripwire on an admission branch that stops holding that. It
   *  says what it says only alongside `sharedDesignations` — a designation two
   *  rows carry keys neither of them, so a row can fall through to the Gaia id
   *  with a classical cell filled. */
  additionGaiaKeyedOnly: number;
  /** Designations more than one manifest row carries, so they key no SID
   *  (/docs/sid.md#41-same-as-equivalence-graph). Admission leaves none that involves an addition;
   *  what remains is the spine's own, which key on a higher rung. */
  sharedDesignations: number;
  /** Groups whose TYC route and HIP route propose different sources. */
  additionRouteSourceDisagree: number;
  /** Admitted rows the guard withheld a designation from — the record ships,
   *  but without a designation the primaries publish for it, because another
   *  record answers to it. */
  additionsWithBlockedDesignation: number;
  rowsWithHdAlt: number;
  rowsWithHrAlt: number;
  /** Spine rows a correction folds onto another, so they become no manifest
   *  row of their own. `spineRows` stays the file's length. */
  spineRowsFolded: number;
  spineCellsCorrected: Record<SpineCorrectionCell, number>;
  /** Spine rows whose derived binding is empty, so no overlay entry can reach
   *  them and their labels are the spine's whole story. */
  spineRowsWithoutSourceId: number;
  /** Spine rows at V <= `BRIGHT_TIER_MAG_CEILING`, and how many of those the
   *  overlay has no row for. Gaia saturates around G = 3, so a source_id-keyed
   *  table structurally cannot carry the brightest stars — the pair pins that
   *  population's size, against reading a high `overlayHd` as the overlay
   *  having replaced the spine's label columns outright. */
  spineBrightRows: number;
  spineBrightRowsWithoutOverlayEntry: number;
}

export interface MembershipResult extends MembershipLedgers {
  rows: ManifestRecord[];
  lineage: LineageRow[];
  identity: IdentityRow[];
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

export function parseBindingDispositionsTsv(
  text: string,
  from: Declared,
): Map<string, BindingDispositionRow> {
  const out = new Map<string, BindingDispositionRow>();
  for (const row of readTable({ ...from, columns: BINDING_DISPOSITION_COLUMNS, exact: true }, text)) {
    const cells = row.cells();
    const key = bindingReviewKey(cells);
    for (const column of ['derived_source_id', 'keep_source_id'] as const) row.sourceId(column);
    if (out.has(key)) row.fail(`duplicate record ${key}`);
    evidenceOf(row, 'evidence', key);
    out.set(key, { ...cells, basis: row.oneOf('basis', BINDING_DISPOSITION_BASES) });
  }
  return out;
}


/** The identifier tuple a ledger row and a manifest row share — the same five
 *  cells the parked ledger keys on. */
export function manifestKey(record: ManifestRecord): string {
  return parkedRecordKey(MEMBERSHIP_MANIFEST.encode(record));
}

// ---- the spine side ----------------------------------------------------------

/** Seeded from the spine after the label merge and GROWN as each addition is
 *  admitted, so two addition groups cannot take one designation either
 *  (/docs/sid.md#41-same-as-equivalence-graph). */
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

/** Matched on the normalised key alone, LETTER INCLUDED — never the bare
 *  number, which is the cohort filter's question and `spineKeys`' to
 *  answer. */
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

/** What the derivation reached for one spine row. */
interface SpineBinding {
  derived: DerivedBinding | null;
  gate: RowGateEvidence | null;
  outcome: BindingOutcome;
}

/** Candidates the gates passed that did not win — a disagreement between
 *  sources the precedence order settled rather than the evidence. Sound only
 *  because `deriveBinding` weighs every ranked candidate: a candidate it left
 *  unweighed would read as passing here on a verdict never taken. */
export function passingRunnersUp(d: DerivedBinding): RankedCandidate[] {
  return d.ranked.filter((c) => c.sourceId !== d.sourceId
    && !d.rejected.some((r) => r.sourceId === c.sourceId));
}

function bindingOutcome(derived: DerivedBinding, withheld: boolean): BindingOutcome {
  if (withheld) return 'collision';
  if (derived.sourceId === null) return 'refused';
  return passingRunnersUp(derived).length > 0 ? 'contested' : 'bound';
}

export const OWN_CANDIDATE_REASONS = [
  'refused_mag', 'refused_sibling', 'withheld', 'runner_up', 'component',
] as const;
export type OwnCandidateReason = (typeof OWN_CANDIDATE_REASONS)[number];

/** Every candidate a row's derivation proposed other than the value it ships,
 *  with why it was not shipped. */
function unshippedCandidates(
  d: DerivedBinding, shipped: string | null,
): Array<[string, OwnCandidateReason]> {
  return d.ranked.flatMap((c): Array<[string, OwnCandidateReason]> => {
    if (c.sourceId === shipped) return [];
    const refusal = d.rejected.find((r) => r.sourceId === c.sourceId);
    if (refusal !== undefined) return [[c.sourceId, `refused_${refusal.reason}`]];
    return [[c.sourceId, c.sourceId === d.sourceId ? 'withheld' : 'runner_up']];
  });
}

type RowDeriver =(row: BindingCells) => { derived: DerivedBinding; gate: RowGateEvidence };

/** The one derivation every primaries row — spine or addition — binds through. */
function rowDeriver(tables: PrimaryTables, idx: PrimaryIndex, evidence: BindingEvidence): RowDeriver {
  const simbad = indexSimbadSources(tables.simbadBySourceId);
  return (row) => {
    const gate = rowGateEvidence(row, evidence, simbad);
    return { derived: deriveBinding(bindingCandidates(row, tables, idx.cns5ByOwnKey, simbad), gate), gate };
  };
}

/** Withholds any source two rows derive — see binding/README.md. */
function deriveSpineBindings(spine: readonly SpineRow[], derive: RowDeriver): SpineBinding[] {
  const bindings: SpineBinding[] = spine.map((row) => {
    if (row.proper === SOL_PROPER_NAME) {
      return { derived: null, gate: null, outcome: 'sol' };
    }
    const { derived, gate } = derive(row);
    return { derived, gate, outcome: bindingOutcome(derived, false) };
  });
  const holders = new Map<string, number[]>();
  bindings.forEach((b, i) => {
    if (b.derived?.sourceId != null) pushKeyed(holders, b.derived.sourceId, i);
  });
  for (const rows of holders.values()) {
    if (rows.length < 2) continue;
    for (const i of rows) bindings[i].outcome = bindingOutcome(bindings[i].derived!, true);
  }
  return bindings;
}

function xidsCell(xids: SimbadXids | undefined): string {
  if (xids === undefined) return '';
  const parts: string[] = [];
  if (xids.hip !== null) parts.push(`hip:${xids.hip}`);
  if (xids.tyc !== null) parts.push(`tyc:${xids.tyc}`);
  if (xids.gj !== null) parts.push(`gj:${xids.gj}`);
  return joinValues(parts);
}

function magCell(value: number | null): string {
  return value === null ? '' : value.toFixed(3);
}

/** Sol derives nothing, so its cells past the spine's own are empty. */
function bindingReviewCells(row: SpineRow, b: SpineBinding, tables: PrimaryTables): BindingReviewCells {
  const spine = { tyc: row.tyc, hip: row.hip, hd: row.hd, hr: row.hr, gl: row.gl };
  if (b.derived === null || b.gate === null) {
    return {
      ...spine, derived_source_id: '', derived_via: '', candidates: '', rejected: '',
      v_mag: '', v_via: '', derived_g: '', derived_simbad: '',
    };
  }
  const derived = b.derived;
  const gate = b.gate;
  const gOf = (id: string | null): string => magCell(id === null ? null : gate.evidence.gMagOf(id));
  const xidsOf = (id: string | null): string => xidsCell(id === null ? undefined : tables.simbadBySourceId.get(id));
  const candidates = derived.ranked.flatMap((c) => c.via.map((v) => `${v}:${c.sourceId}`));
  return {
    ...spine,
    derived_source_id: derived.sourceId ?? '',
    derived_via: derived.via.join('+'),
    candidates: joinValues(candidates),
    rejected: joinValues(derived.rejected.map((r) => `${r.sourceId}:${r.reason}`)),
    v_mag: magCell(gate.printedV?.vMag ?? null),
    v_via: gate.printedV?.vVia ?? '',
    derived_g: gOf(derived.sourceId),
    derived_simbad: xidsOf(derived.sourceId),
  };
}

function wdsLetters(attributions: readonly WdsComponentAttribution[] | undefined): string {
  return joinValues((attributions ?? []).map((a) => `${a.wdsId}:${a.component}`));
}

function spineBindingOutcome(
  row: SpineRow, b: SpineBinding, tables: PrimaryTables, xids: SimbadWdsXidIndex | null,
): MembershipOutcome {
  const sourceId = b.derived?.sourceId ?? null;
  const letters = {
    sourceLetters: sourceId === null ? '' : wdsLetters(xids?.bySource.get(sourceId)),
    hipLetters: wdsLetters(xids?.byHip.get(intCell(row.hip) ?? -1)),
  };
  if (b.outcome === 'contested' || b.outcome === 'collision') {
    return { kind: 'spine-binding-queued', outcome: b.outcome, review: bindingReviewCells(row, b, tables), ...letters };
  }
  return {
    kind: 'spine-binding',
    outcome: b.outcome === 'bound' && b.derived?.rescued ? 'rescued' : b.outcome,
    sourceId: sourceId ?? '',
    via: b.derived?.via.join('+') ?? '',
    ...letters,
  };
}

/** The candidates a derivation weighed and did not take: each gate refusal,
 *  and each runner-up that passed. */
function refusedCandidates(key: string, d: DerivedBinding): KeyedOutcome[] {
  const refused = d.rejected.map((r): KeyedOutcome => ({
    key,
    outcome: { kind: 'candidate-refused', refusal: r.reason, sourceId: r.sourceId, via: r.via.join('+') },
  }));
  const runnersUp = passingRunnersUp(d).map((c): KeyedOutcome => ({
    key,
    outcome: { kind: 'candidate-refused', refusal: 'runner-up', sourceId: c.sourceId, via: c.via.join('+') },
  }));
  return [...refused, ...runnersUp];
}

function additionBindingOutcome(g: AdditionGroup): AdditionBindingOutcome {
  if (g.derived.sourceId === null) return g.derived.ranked.length > 0 ? 'refused' : 'no-candidate';
  if (g.sourceOnSpine) return 'on-spine';
  if (g.source === null) return 'shared';
  return g.derived.rescued ? 'rescued' : 'bound';
}

/** See binding/README.md. */
function settleBinding(
  b: SpineBinding, disposition: BindingDispositionRow | undefined, evidence: BindingEvidence,
): { value: string | null; binding: BindingClass; asserted: boolean } {
  const derived = b.derived!;
  if (disposition === undefined) {
    const shippable = b.outcome === 'bound' || b.outcome === 'contested';
    return shippable && derived.sourceId !== null
      ? { value: derived.sourceId, binding: derived.binding, asserted: false }
      : { value: null, binding: 'none', asserted: false };
  }
  const key = bindingReviewKey(disposition);
  if (disposition.derived_source_id !== (derived.sourceId ?? '')) {
    throw new Error(
      `binding-review-dispositions.tsv: row ${key} disposes a derivation reaching `
        + `${disposition.derived_source_id || '(nothing)'}, but it now reaches `
        + `${derived.sourceId || '(nothing)'}; re-review it`,
    );
  }
  const keep = disposition.keep_source_id;
  if (keep === '') return { value: null, binding: 'none', asserted: false };
  const asserted = !derived.ranked.some((c) => c.sourceId === keep);
  // A `simbad_dr2_object` id is in the DR2 namespace, so no DR3 table can carry
  // it; dropping the exemption fails the build on the rows that basis exists for.
  if (asserted && disposition.basis !== 'simbad_dr2_object' && !evidence.hasPulledRow(keep)) {
    throw new Error(
      `binding-review-dispositions.tsv: row ${key} keeps ${keep}, which no source proposes `
        + 'and the Gaia DR3 astrometry catalogue has no row for; re-check the id',
    );
  }
  return { value: keep, binding: 'reviewed', asserted };
}

/** Empty the spine-label cells no primary attests — the Flamsteed number, and
 *  the HD number with its aliases — into label-parity ledger rows (/docs/catalog-driver.md#62-label-parity) keyed on the row as
 *  it stands afterwards, so each joins the manifest row it left. Returns the
 *  attestation of the row it leaves behind, which is the one `routesCell`
 *  needs: the HD drop runs first because IV/27A can publish a Flamsteed number
 *  against an HD no HD primary attests. */
function dropUnattestedLabels(
  row: ManifestCells, tables: PrimaryTables, idx: PrimaryIndex, key: string, into: KeyedOutcome[],
): RowAttestation {
  const dropped: Array<{ cell: 'hd' | 'flam'; value: string; reason: LabelDropReason }> = [];
  const hds = [row.hd, ...splitValues(row.hd_alt)].filter((h) => h !== '');
  const kept = hds.filter((h) => {
    const hd = intCell(h);
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
    into.push({ key, outcome: { kind: 'label-drop', reason: d.reason, cell: d.cell, value: d.value } });
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

function toRecord(cells: ManifestCells): ManifestRecord {
  return manifestRecord((c) => cells[c], (m) => {
    throw new Error(`manifest row ${parkedRecordKey(cells)}: ${m}`);
  });
}

function manifestRowFromRecord(
  cells: { tyc: string; bayer: string; proper: string },
  r: LabelMergeRecord,
  binding: BindingClass,
): ManifestCells {
  return {
    tyc: cells.tyc,
    hip: nullableCell(r.hip),
    hd: nullableCell(r.hd),
    hd_alt: joinValues(r.hdAlt),
    hr: nullableCell(r.hr),
    hr_alt: joinValues(r.hrAlt),
    gl: r.gl ?? '',
    flam: nullableCell(r.flam),
    bayer: cells.bayer,
    proper: cells.proper,
    gaia_source_id: r.gaiaSourceId ?? '',
    binding,
    routes: '',
    term: 'primaries',
  };
}

/** One magnitude-term row — every classical cell empty, the source_id its
 *  whole identity. */
function magnitudeTermRow(sourceId: string): ManifestCells {
  return {
    tyc: '', hip: '', hd: '', hd_alt: '', hr: '', hr_alt: '', gl: '', flam: '',
    bayer: '', proper: '',
    gaia_source_id: sourceId,
    binding: 'gaia_native',
    routes: '',
    term: 'magnitude',
  };
}

// ---- the additions -----------------------------------------------------------

/** One primary's row the spine lacks, before the cohorts are merged: the same
 *  star reaches this list once per primary that names it. */
interface AdditionItem extends AdditionCohorts {
  key: string;
  /** What this item alone derives — two items deriving one source are one star. */
  derived: DerivedBinding;
}

type AdditionCohorts = { hd: HdAddition | null; hip: HipAddition | null; cns5: Cns5Row | null };

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

/** Two TYC items are two Tycho-2 stars whatever the best-neighbour walk
 *  says, and take no side. */
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
    if (i.derived.sourceId === null) continue;
    pushKeyed(bySource, i.derived.sourceId, i);
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

/** One star's items merged across the primaries, with the derivation's verdict
 *  on the source they reach. Everything admission needs except the claim set,
 *  which grows under it — so these are resolved before the first group is
 *  admitted and fix the order the contested designations go in. */
interface AdditionGroup {
  hd: HdAddition | null;
  hip: HipAddition | null;
  cns5: Cns5Row | null;
  rawGl: string | null;
  tyc: string;
  source: string | null;
  binding: BindingClass;
  derived: DerivedBinding;
  sourceOnSpine: boolean;
  sourceGateRefused: boolean;
  routeSourceDisagree: boolean;
  /** The anchor item's source row — IV/25, else I/239, else CNS5 — with the
   *  other items' rows as evidence. */
  origin: string;
  members: string[];
}

function itemOrigin(item: AdditionCohorts, keys: OriginKeys): string {
  if (item.hd !== null) return keys.iv25(item.hd.tyc);
  if (item.hip !== null) return keys.i239(item.hip.hip);
  return keys.cns5(item.cns5!.cns5);
}

function soleItem<K extends keyof AdditionCohorts>(
  items: readonly AdditionCohorts[], cohort: K,
): AdditionCohorts[K] | null {
  return items.find((i) => i[cohort] !== null)?.[cohort] ?? null;
}

function cns5Gl(cns5: Cns5Row | null): string | null {
  return cns5 === null ? null : `GJ ${cns5.gj}${cns5.gjComp ?? ''}`;
}

/** The cells a group derives its binding from — the same three a spine row's
 *  derivation reads. */
function additionCells(items: readonly AdditionCohorts[]): BindingCells {
  const hip = soleItem(items, 'hip');
  return {
    tyc: soleItem(items, 'hd')?.tyc ?? '',
    hip: hip === null ? '' : String(hip.hip),
    gl: cns5Gl(soleItem(items, 'cns5')) ?? '',
  };
}

function additionCohortItems(
  tables: PrimaryTables, kept: readonly SpineRow[], idx: PrimaryIndex,
): Array<Omit<AdditionItem, 'derived'>> {
  const additions = findAdditions(tables, spineKeys(kept), idx);
  return [
    ...additions.hd.map((hd) => ({ key: `tyc:${hd.tyc}`, hd, hip: null, cns5: null })),
    ...additions.hip.map((hip) => ({ key: `hip:${hip.hip}`, hd: null, hip, cns5: null })),
    ...additions.cns5.newRecords.map((cns5) => ({
      key: `cns5:${cns5.cns5}`, hd: null, hip: null, cns5,
    })),
  ];
}

/** ../astrometry-request/README.md#the-request-is-a-union-and-why-that-is-not-a-compromise. */
export function additionItemCells(
  tables: PrimaryTables, kept: readonly SpineRow[],
): BindingCells[] {
  return additionCohortItems(tables, kept, indexPrimaries(tables)).map((i) => additionCells([i]));
}

function candidateVia(d: DerivedBinding, source: BindingSource): string | null {
  return d.ranked.find((c) => c.via.includes(source))?.sourceId ?? null;
}

function additionGroup(
  items: readonly AdditionItem[],
  derived: DerivedBinding,
  claims: Claims,
  sharedSources: ReadonlySet<string>,
  keys: OriginKeys,
): AdditionGroup {
  // One item per cohort is what the grouping rules produce and what admission
  // reads; a second would leave a primary's row in no manifest row and on no
  // ledger line, which record parity (/docs/catalog-driver.md#61-record-parity) forbids outright. Loud beats silent: the shape is
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
  const hd = soleItem(items, 'hd');
  const cns5 = soleItem(items, 'cns5');
  const winner = derived.sourceId;
  const sourceOnSpine = winner !== null && claims.gaia.has(winner);
  const source = winner !== null && !sourceOnSpine && !sharedSources.has(winner) ? winner : null;
  const tycSource = candidateVia(derived, 'tyc');
  const hipSource = candidateVia(derived, 'hip');
  const anchor = ['hd', 'hip', 'cns5'].map((c) => items.find((i) => i[c as keyof AdditionCohorts] !== null))
    .find((i) => i !== undefined)!;
  return {
    origin: itemOrigin(anchor, keys),
    members: items.filter((i) => i !== anchor).map((i) => itemOrigin(i, keys)).sort(),
    hd, hip: soleItem(items, 'hip'), cns5,
    rawGl: cns5Gl(cns5),
    tyc: hd?.tyc ?? '',
    source,
    binding: source === null ? 'none' : derived.binding,
    derived,
    sourceOnSpine,
    sourceGateRefused: derived.ranked.length > 0 && winner === null,
    routeSourceDisagree: tycSource !== null && hipSource !== null && tycSource !== hipSource,
  };
}

/** Two groups can arrive with the same designation and no spine record to lose
 *  it to — IV/25 resolving one HD onto two Tycho-2 stars is the shape, and it
 *  flags them `n_tyc > 1`. Admission is sequential, so this order decides which
 *  one takes the designation and which ledgers onto it as a component: the
 *  group whose Gaia binding survives the HD-route gate (/docs/catalog-driver.md#4-how-hd-reaches-gaia) first, since the other
 *  component would otherwise park for want of a parallax this one has, then by
 *  TYC, HIP and GJ — a total order over content, never over walk order. */
function additionGroupOrder(
  publishesGaiaParallax: (sourceId: string) => boolean,
): (a: AdditionGroup, b: AdditionGroup) => number {
  const rank = (g: AdditionGroup): number => (
    g.source === null ? 2 : publishesGaiaParallax(g.source) ? 0 : 1
  );
  return (a, b) => rank(a) - rank(b) || compareAdditionGroupCells(a, b);
}

function compareAdditionGroupCells(a: AdditionGroup, b: AdditionGroup): number {
  if (a.tyc !== b.tyc) return a.tyc < b.tyc ? -1 : 1;
  const hipA = a.hip?.hip ?? 0;
  const hipB = b.hip?.hip ?? 0;
  if (hipA !== hipB) return hipA - hipB;
  const glA = a.rawGl ?? '';
  const glB = b.rawGl ?? '';
  return glA < glB ? -1 : glA > glB ? 1 : 0;
}

interface Admission {
  verdict:
    /** `record` is the admitted row's, for the claim set. */
    | { kind: 'admitted'; reason: AdditionReason; row: ManifestCells; record: LabelMergeRecord }
    /** Keyed on the cells it arrived with, since it becomes no row. */
    | { kind: 'component'; designation: string; cells: IdentityCells };
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
      blocked,
      verdict: {
        kind: 'component',
        designation: blocked.sort(compareDesignations)[0],
        cells: {
          tyc,
          hip: nullableCell(hipItem?.hip ?? null),
          hd: nullableCell(hdItem === null ? null : Math.min(...hdItem.hds)),
          gl: rawGl ?? '',
          gaia_source_id: '',
        },
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
  const row = manifestRowFromRecord({ tyc, bayer: '', proper: '' }, record, group.binding);
  return { blocked, verdict: { kind: 'admitted', reason, row, record } };
}

type IdentityCells = Pick<IdentityRow, 'tyc' | 'hip' | 'hd' | 'gl' | 'gaia_source_id'>;

function identityOf(key: string, cells: IdentityCells, designations: readonly string[]): IdentityRow {
  return {
    key, tyc: cells.tyc, hip: cells.hip, hd: cells.hd, gl: cells.gl,
    gaia_source_id: cells.gaia_source_id, designations,
  };
}

// ---- the build -----------------------------------------------------------------

export function buildMembership(input: MembershipInput): MembershipResult {
  const {
    spine, tables, overlay, overrides, siblingRenderedSourceIds, evidence, dispositions,
    corrections,
  } = input;
  const idx = indexPrimaries(tables);
  const { keys } = input;
  const { corrected, kept, keptSpineIndex, folds } = applySpineCorrections(spine, corrections);
  const spineKey = (keptRow: number): string => keys.spine(keptSpineIndex[keptRow]);
  const spineCellsCorrected = Object.fromEntries(
    SPINE_CORRECTION_CELLS.map((c) => [c, corrections.filter(
      (r) => r.op === 'set' && r.cell === c,
    ).length]),
  ) as Record<SpineCorrectionCell, number>;

  const bindingByClass = Object.fromEntries(
    BINDING_CLASSES.map((c) => [c, 0]),
  ) as Record<BindingClass, number>;
  const unattestedByCell = Object.fromEntries(
    CLASSICAL_CELLS.map((c) => [c, 0]),
  ) as Record<ClassicalCell, number>;
  const outcomes: KeyedOutcome[] = [];
  const identity: IdentityRow[] = [];
  const rows: ManifestCells[] = [];
  const rowKeys: string[] = [];
  const attest = (key: string, row: ManifestCells, a?: RowAttestation): void => {
    const { routes, unattested } = routesCell(a ?? attestSpineRow(row, tables, idx));
    row.routes = routes;
    for (const cell of unattested) unattestedByCell[cell]++;
    bindingByClass[row.binding as BindingClass]++;
    rows.push(row);
    rowKeys.push(key);
  };

  const derivationOutcome = Object.fromEntries(
    BINDING_OUTCOMES.map((c) => [c, 0]),
  ) as Record<BindingOutcome, number>;
  const bindingDispositions = Object.fromEntries(
    BINDING_DISPOSITIONS.map((d) => [d, 0]),
  ) as Record<BindingDisposition, number>;
  const derivedVia = Object.fromEntries(
    BINDING_SOURCES.map((s) => [s, 0]),
  ) as Record<BindingSource, number>;
  const derivedRejected = { mag: 0, sibling: 0 };
  let derivedConsensus = 0;
  let dispositionAsserted = 0;
  let derivedUngateable = 0;
  let derivedWeighedNoGMag = 0;
  let derivedWeighedNullGMag = 0;
  const applied = new Set<string>();

  const derive = rowDeriver(tables, idx, evidence);
  const spineBindings = deriveSpineBindings(kept, derive);
  const settled = spineBindings.map((b, i) => {
    const spineRow = kept[i];
    const origin = spineKey(i);
    derivationOutcome[b.outcome]++;
    outcomes.push(
      { key: origin, outcome: { kind: 'admit-spine' } },
      { key: origin, outcome: spineBindingOutcome(spineRow, b, tables, evidence.wdsXids) },
    );
    let value: string | null = null;
    let binding: BindingClass = 'none';
    if (b.derived !== null) {
      const d = b.derived;
      outcomes.push(...refusedCandidates(origin, d));
      for (const r of d.rejected) derivedRejected[r.reason]++;
      derivedWeighedNoGMag += d.weighedNoGMag;
      derivedWeighedNullGMag += d.weighedNullGMag;
      if (!d.gateable && d.ranked.length > 0) derivedUngateable++;
      const key = bindingReviewKey(spineRow);
      const disposition = dispositions.get(key);
      const s = settleBinding(b, disposition, evidence);
      value = s.value;
      binding = s.binding;
      if (disposition !== undefined) {
        bindingDispositions[dispositionOf(disposition)]++;
        if (s.asserted) dispositionAsserted++;
        applied.add(key);
        outcomes.push({
          key: origin,
          outcome: {
            kind: 'disposition', outcome: dispositionOf(disposition),
            keep: disposition.keep_source_id, basis: disposition.basis,
            review: bindingReviewCells(spineRow, b, tables),
          },
        });
      }
      if (value !== null && value === d.sourceId) {
        derivedVia[d.via[0]]++;
        if (d.via.length > 1) derivedConsensus++;
      }
    }
    return { value, binding };
  });
  for (const key of dispositions.keys()) {
    if (!applied.has(key)) {
      throw new Error(`binding-review-dispositions.tsv: row ${key} disposes no spine row; remove it`);
    }
  }
  const held = new Map<string, number>();
  for (const s of settled) {
    if (s.value !== null) held.set(s.value, (held.get(s.value) ?? 0) + 1);
  }
  const duplicated = [...held].filter(([, n]) => n > 1).map(([id]) => id);
  if (duplicated.length > 0) {
    throw new Error(`two spine rows bind one Gaia source: ${duplicated.join(', ')}`);
  }

  // The merge keys on the DERIVED binding, so the labels a record takes are the
  // ones the overlay hangs on the source it is actually bound to.
  const spineSides = kept.map((row, i) => spineLabelMergeRecord(row, settled[i].value));
  const records = spineSides.map((s) => s.record);
  const merge = mergeClassicIdLabels({
    records,
    labels: spineSides.map((s) => s.label),
    overlay,
    overrides,
    siblingRenderedSourceIds,
  });
  let spineRowsWithoutSourceId = 0;
  let spineBrightRows = 0;
  let spineBrightRowsWithoutOverlayEntry = 0;
  const spineManifestRows: ManifestCells[] = [];
  records.forEach((record, i) => {
    const noEntry = record.gaiaSourceId === null || !overlay.has(record.gaiaSourceId);
    if (record.gaiaSourceId === null) spineRowsWithoutSourceId++;
    // Sol derives no binding, so it carries no gate evidence of its own.
    const mag = kept[i].proper === SOL_PROPER_NAME
      ? SOL_APPARENT_V_MAGNITUDE
      : spineBindings[i].gate?.printedV?.vMag ?? null;
    if (mag !== null && mag <= BRIGHT_TIER_MAG_CEILING) {
      spineBrightRows++;
      if (noEntry) spineBrightRowsWithoutOverlayEntry++;
    }
    const row = manifestRowFromRecord(kept[i], record, settled[i].binding);
    spineManifestRows.push(row);
    attest(spineKey(i), row, dropUnattestedLabels(row, tables, idx, spineKey(i), outcomes));
  });
  const keyBySource = new Map<string, string>();
  records.forEach((r, i) => {
    if (r.gaiaSourceId !== null) keyBySource.set(r.gaiaSourceId, spineKey(i));
  });
  for (const { sourceId, ...flip } of merge.flips) {
    const key = keyBySource.get(sourceId);
    if (key === undefined) throw new Error(`label merge flipped ${flip.field} on ${sourceId}, which no spine record binds`);
    outcomes.push({ key, outcome: { kind: 'label-flip', flip } });
  }
  // A fold claims two spine rows are one star, so the survivor has to end up
  // answering to everything the folded row did — otherwise the fold is a
  // silent record drop rather than a merge.
  for (const { foldedRow, survivorRow, survivorKept } of folds) {
    const folded = corrected[foldedRow];
    outcomes.push({ key: keys.spine(foldedRow), outcome: { kind: 'fold', survivor: keys.spine(survivorRow) } });
    identity.push(identityOf(keys.spine(foldedRow), { ...folded, gaia_source_id: '' }, spineDesignations(folded)));
    const survivorHolds = new Set(manifestDesignations(toRecord(spineManifestRows[survivorKept])));
    const lost = spineDesignations(corrected[foldedRow]).filter((d) => !survivorHolds.has(d));
    if (lost.length > 0) {
      throw new Error(
        `${SPINE_CORRECTIONS_NAME}: folding ${bindingReviewKey(corrected[foldedRow])} loses `
          + `${lost.join(', ')} — the survivor does not answer to it`,
      );
    }
  }

  const claims = spineClaims(records);
  const items: AdditionItem[] = additionCohortItems(tables, kept, idx).map((i) => ({
    ...i, derived: derive(additionCells([i])).derived,
  }));
  const index = indexAdditions(tables);
  const derivedGroups = groupAdditions(items, tables, index).map((g) => ({
    items: g, derived: g.length === 1 ? g[0].derived : derive(additionCells(g)).derived,
  }));
  const sourceGroups = new Map<string, number>();
  for (const { derived } of derivedGroups) {
    if (derived.sourceId !== null) {
      sourceGroups.set(derived.sourceId, (sourceGroups.get(derived.sourceId) ?? 0) + 1);
    }
  }
  const sharedSources = new Set([...sourceGroups].filter(([, n]) => n > 1).map(([s]) => s));
  const groups = derivedGroups
    .map((g) => additionGroup(g.items, g.derived, claims, sharedSources, keys))
    .sort(additionGroupOrder(input.publishesGaiaParallax));

  const additionsByReason = Object.fromEntries(
    ADDITION_REASONS.map((r) => [r, 0]),
  ) as Record<AdditionReason, number>;
  let componentRows = 0;
  let additionSourceOnSpine = 0;
  let additionSourceGateRefused = 0;
  let additionRouteSourceDisagree = 0;
  let additionGaiaKeyedOnly = 0;
  let additionsWithBlockedDesignation = 0;
  const additionWeighedNoGMag = [
    ...items.map((i) => i.derived),
    ...derivedGroups.filter((g) => g.items.length > 1).map((g) => g.derived),
  ].reduce((n, d) => n + d.weighedNoGMag, 0);
  let additionContested = 0;
  const ownCandidates = new Map<string, OwnCandidateReason>();
  const noteUnshipped = (d: DerivedBinding, shipped: string | null): void => {
    for (const [id, reason] of unshippedCandidates(d, shipped)) {
      if (!ownCandidates.has(id)) ownCandidates.set(id, reason);
    }
  };
  spineBindings.forEach((b, i) => {
    if (b.derived !== null) noteUnshipped(b.derived, settled[i].value);
  });
  for (const g of groups) {
    const a = admitGroup(g, claims, index);
    if (g.source !== null && passingRunnersUp(g.derived).length > 0) additionContested++;
    const component = a.verdict.kind === 'component';
    if (component && g.derived.sourceId !== null && !ownCandidates.has(g.derived.sourceId)) {
      ownCandidates.set(g.derived.sourceId, 'component');
    }
    noteUnshipped(g.derived, component ? null : g.source);
    if (g.sourceOnSpine) additionSourceOnSpine++;
    if (g.sourceGateRefused) additionSourceGateRefused++;
    if (g.routeSourceDisagree) additionRouteSourceDisagree++;
    outcomes.push(
      { key: g.origin, outcome: {
        kind: 'addition-binding', outcome: additionBindingOutcome(g),
        sourceId: g.derived.sourceId ?? '', via: g.derived.via.join('+'),
      } },
      ...refusedCandidates(g.origin, g.derived),
    );
    if (a.verdict.kind === 'component') {
      componentRows++;
      outcomes.push({
        key: g.origin,
        outcome: { kind: 'component', designation: a.verdict.designation, members: g.members },
      });
      identity.push(identityOf(g.origin, a.verdict.cells, [...a.blocked].sort(compareDesignations)));
      continue;
    }
    outcomes.push({
      key: g.origin, outcome: { kind: 'admit-addition', reason: a.verdict.reason, members: g.members },
    });
    additionsByReason[a.verdict.reason]++;
    if (a.blocked.length > 0) additionsWithBlockedDesignation++;
    const designations = manifestDesignations(toRecord(a.verdict.row));
    if (designations.length === 1 && designations[0].startsWith('gaia_dr3:')) additionGaiaKeyedOnly++;
    claimRecord(claims, a.verdict.record);
    attest(g.origin, a.verdict.row);
  }

  const primariesRows = rows.length;
  const boundSourceIds = new Set(
    rows.map((r) => r.gaia_source_id).filter((s) => s !== ''),
  );
  const magnitudeRowsOwnCandidate = Object.fromEntries(
    OWN_CANDIDATE_REASONS.map((r) => [r, 0]),
  ) as Record<OwnCandidateReason, number>;
  for (const sourceId of magnitudeTermNewcomers(
    input.magnitudeTerm?.keptSourceIds ?? new Set(),
    boundSourceIds,
  )) {
    const own = ownCandidates.get(sourceId);
    if (own !== undefined) magnitudeRowsOwnCandidate[own]++;
    const row = magnitudeTermRow(sourceId);
    bindingByClass[row.binding as BindingClass]++;
    rows.push(row);
    rowKeys.push(keys.gaia(sourceId));
    outcomes.push({ key: keys.gaia(sourceId), outcome: { kind: 'admit-magnitude' } });
  }

  const typed = rows.map(toRecord);
  typed.forEach((r, i) => identity.push(identityOf(rowKeys[i], rows[i], manifestDesignations(r))));
  const lineage = outcomes.map(membershipLineageRow);
  const ledgers = membershipLedgers(lineage, new Map(identity.map((r) => [r.key, r])));
  const bindingReviewByVerdict = Object.fromEntries(BINDING_REVIEW_VERDICTS.map(
    (v) => [v, ledgers.bindingReview.filter((r) => r.verdict === v).length],
  )) as Record<BindingReviewVerdict, number>;
  const sorted = sortManifestRecords(typed);
  const owners = new Map<string, number>();
  for (const row of sorted) {
    for (const d of new Set(manifestDesignations(row))) owners.set(d, (owners.get(d) ?? 0) + 1);
  }
  const counts: MembershipCounts = {
    ...merge.counts,
    rows: sorted.length,
    spineRows: spine.length,
    spineRowsFolded: spine.length - kept.length,
    spineCellsCorrected,
    additionRows: primariesRows - kept.length,
    magnitudeTerm: input.magnitudeTerm?.counts
      ?? { rows: 0, kept: 0, above_floor: 0, no_v: 0 },
    magnitudeRows: sorted.length - primariesRows,
    magnitudeRowsOwnCandidate,
    additionsByReason,
    componentRows,
    bindingByClass,
    bindingReviewRows: ledgers.bindingReview.length,
    bindingReviewByVerdict,
    bindingDispositions,
    derivationOutcome,
    derivedVia,
    derivedConsensus,
    dispositionAsserted,
    derivedRejected,
    derivedUngateable,
    derivedWeighedNoGMag,
    derivedWeighedNullGMag,
    labelDropsByReason: Object.fromEntries(LABEL_DROP_REASONS.map(
      (reason) => [reason, ledgers.labelDrops.filter((d) => d.reason === reason).length],
    )) as Record<LabelDropReason, number>,
    unattestedByCell,
    additionSourceOnSpine,
    additionSourceGateRefused,
    additionSourceShared: sharedSources.size,
    additionWeighedNoGMag,
    additionContested,
    additionGaiaKeyedOnly,
    additionRouteSourceDisagree,
    additionsWithBlockedDesignation,
    sharedDesignations: [...owners.values()].filter((n) => n > 1).length,
    rowsWithHdAlt: sorted.filter((r) => r.hdAlt.length > 0).length,
    rowsWithHrAlt: sorted.filter((r) => r.hrAlt.length > 0).length,
    spineRowsWithoutSourceId,
    spineBrightRows,
    spineBrightRowsWithoutOverlayEntry,
  };
  return { rows: sorted, ...ledgers, lineage, identity, counts };
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
 *  manifest row dropped first (/docs/sid.md#41-same-as-equivalence-graph), and the row keyed on its
 *  first ladder-ranked designation the graph knows — its canonical key. A
 *  lower-ranked designation the label merge moved to a sibling therefore does
 *  not split the match: the SID never rode on it. */
export function matchSpineToManifest(
  spineDesignations: readonly (readonly string[])[],
  manifestRows: readonly ManifestRecord[],
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

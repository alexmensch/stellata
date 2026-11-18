// A manifest row's gaia_source_id derived from committed evidence: four sources,
// two-source consensus first, each candidate through both binding gates.
// See README.md.

import { normaliseGjKey } from '../../simbad/simbad-namespace-ladder-pure';
import { printedV, type PrintedV } from '../../photometry/v-magnitude-pure';
import {
  isSiblingLetterAttribution,
  rejectionOf,
  weighBinding,
  type BindingEvidence,
  type GateReason,
  type GateRow,
} from './binding-gate-pure';
import type { Cns5Row } from '../../classic-ids/classic-ids-parse';
import { compareSourceIds, intCell } from '../../../util/tsv/table-pure';
import {
  bareGjKey,
  glKeyForms,
  glKeyVariants,
  type BindingTables,
} from '../../spine/primaries-audit-pure';
import type { SimbadXids } from '../../spectral/spectral-resolve';
import type { SkyPosition } from '../../../../src/astro-core/equatorial-basis';
import {
  hipparcosNamesSource,
  hipparcosSeparationFromSource,
  type NearSource,
  type SourceAstrometry,
} from '../positional-witness/positional-witness-pure';

/** Precedence order: the record's own TYC through the Tycho-2 best-neighbour
 *  walk, its HIP through the Hipparcos-2 walk, CNS5's EDR3 id on its GJ, then
 *  the Gaia source SIMBAD indexes under one of its designations. */
export const BINDING_SOURCES = ['tyc', 'hip', 'cns5', 'simbad'] as const;
export type BindingSource = (typeof BINDING_SOURCES)[number];

export type BindingCandidates = Record<BindingSource, string | null>;

/** The cells a derivation reads off a row. */
export type BindingCells = { tyc: string; hip: string; gl: string };

/** SIMBAD's frozen cross-IDs inverted: which Gaia source SIMBAD's object for a
 *  HIP / TYC / GJ carries. A key two objects claim proposes nothing (`null`). */
export interface SimbadSourceIndex {
  byHip: Map<number, string | null>;
  byTyc: Map<string, string | null>;
  /** Keyed on SIMBAD's own `gj` through `normaliseGjKey` — `820 B` → `820B` —
   *  AND on its bare number. */
  byGj: Map<string, string | null>;
}

function claim<K>(index: Map<K, string | null>, key: K, sourceId: string): void {
  const held = index.get(key);
  if (held === undefined) index.set(key, sourceId);
  else if (held !== sourceId) index.set(key, null);
}

function contest<K>(index: Map<K, string | null>, key: K): void {
  if (index.has(key)) index.set(key, null);
}

function forEachKey(
  xids: SimbadXids, index: SimbadSourceIndex,
  each: <K>(map: Map<K, string | null>, key: K) => void,
): void {
  if (xids.hip !== null) each(index.byHip, xids.hip);
  if (xids.tyc !== null) each(index.byTyc, xids.tyc);
  const gj = normaliseGjKey(xids.gj);
  if (gj === null) return;
  each(index.byGj, gj);
  const bare = bareGjKey(gj);
  if (bare !== gj) each(index.byGj, bare);
}

/** An object SIMBAD holds with no Gaia id proposes nothing, but it is still a
 *  second claimant of every key it carries. */
export function indexSimbadSources(
  bySourceId: ReadonlyMap<string, SimbadXids>, sourceless: readonly SimbadXids[],
): SimbadSourceIndex {
  const out: SimbadSourceIndex = { byHip: new Map(), byTyc: new Map(), byGj: new Map() };
  for (const [sourceId, xids] of bySourceId) forEachKey(xids, out, (map, key) => claim(map, key, sourceId));
  for (const xids of sourceless) forEachKey(xids, out, contest);
  return out;
}

/** First key the index holds. A key held as `null` — two claimants — is still
 *  held, so it stops the walk rather than falling through to the next. */
function firstHeld<K, V>(index: ReadonlyMap<K, V>, keys: readonly K[]): V | undefined {
  for (const key of keys) {
    const held = index.get(key);
    if (held !== undefined) return held;
  }
  return undefined;
}

/** SIMBAD's proposal for a row: hip → tyc → gj, the GJ exact (with its bridged
 *  spellings) before bare, so a component cell reaches its own entry before the
 *  system's. */
export function simbadCandidate(
  row: BindingCells, simbad: SimbadSourceIndex, glAliases: ReadonlyMap<string, readonly string[]>,
): string | null {
  const hip = intCell(row.hip);
  if (hip !== null && simbad.byHip.has(hip)) return simbad.byHip.get(hip) ?? null;
  if (row.tyc !== '' && simbad.byTyc.has(row.tyc)) return simbad.byTyc.get(row.tyc) ?? null;
  const glKey = normaliseGjKey(row.gl === '' ? null : row.gl);
  if (glKey === null) return null;
  const { exact, bare } = glKeyVariants(glKey, glAliases);
  return firstHeld(simbad.byGj, [...exact, ...bare]) ?? null;
}

/** `cns5ByOwnKey` is the component-stopping index (`Cns5Index`), so a bare
 *  record cell never takes a lettered row's source. */
export function bindingCandidates(
  row: BindingCells,
  tables: BindingTables,
  cns5ByOwnKey: ReadonlyMap<string, Cns5Row>,
  simbad: SimbadSourceIndex,
): BindingCandidates {
  const hip = intCell(row.hip);
  const glKey = normaliseGjKey(row.gl === '' ? null : row.gl);
  const cns5Row = glKey === null
    ? undefined
    : firstHeld(cns5ByOwnKey, glKeyForms(glKey, tables.glAliases));
  return {
    tyc: row.tyc === '' ? null : tables.tycToSource.get(row.tyc) ?? null,
    hip: hip === null ? null : tables.hipToSource.get(hip) ?? null,
    cns5: cns5Row?.gaiaSourceId ?? null,
    simbad: simbadCandidate(row, simbad, tables.glAliases),
  };
}

export interface RankedCandidate {
  sourceId: string;
  /** The sources proposing it, in precedence order. */
  via: BindingSource[];
}

/** Distinct candidates, a value two sources agree on ahead of a lone leader,
 *  ties in precedence order. */
export function rankCandidates(candidates: BindingCandidates): RankedCandidate[] {
  const ranked: RankedCandidate[] = [];
  for (const source of BINDING_SOURCES) {
    const sourceId = candidates[source];
    if (sourceId === null) continue;
    const held = ranked.find((r) => r.sourceId === sourceId);
    if (held === undefined) ranked.push({ sourceId, via: [source] });
    else held.via.push(source);
  }
  return ranked.sort((a, b) => b.via.length - a.via.length);
}

export type DerivedBindingClass = 'crosswalk_gated' | 'simbad_corroborated' | 'position_witnessed' | 'none';

export interface RejectedCandidate extends RankedCandidate {
  reason: GateReason;
}

/** Which witness bound a winner every candidate had refused, or a row with none: README.md#both-gates-weigh-every-candidate,
 *  README.md#identity-outranks-a-blended-magnitude, README.md#the-position-witness. */
export type Rescue = 'component' | 'identity' | 'position';

export interface DerivedBinding {
  sourceId: string | null;
  via: BindingSource[];
  binding: DerivedBindingClass;
  rescue: Rescue | null;
  /** The identity witness, where it named a refused candidate: the winner when its position
   *  confirms it, else the row is queued (`isUnconfirmed`). */
  identity: IdentityWitness | null;
  /** The position witness, where it bound the row. */
  position: BoundPosition | null;
  ranked: RankedCandidate[];
  rejected: RejectedCandidate[];
  /** The row carries a printed V, so the magnitude gate could weigh its
   *  candidates. */
  gateable: boolean;
  /** Candidates weighed with no row in the astrometry pull: the request
   *  under-covering the derivation (README.md#the-candidates-have-to-be-in-the-astrometry-pull). */
  unweighedNoPulledRow: RankedCandidate[];
  /** Candidates weighed on a pulled row publishing no `phot_g_mean_mag`. */
  weighedNullGMag: RankedCandidate[];
}

/** The evidence a row's candidates are weighed against: the row's own HIP and
 *  printed V, the source SIMBAD files its own TYC under, plus the shared
 *  per-source tables. */
export interface RowGateEvidence extends GateRow {
  /** The component witness — null where SIMBAD files the TYC under no source
   *  or under two (README.md#both-gates-weigh-every-candidate). */
  tycWitness: string | null;
  /** Null where SIMBAD files the row's HIP under no source or under two. */
  identity: IdentityWitness | null;
  /** Null where no floor source the sibling arm passes lies within a second of arc of the HIP. */
  position: PositionWitness | null;
  evidence: BindingEvidence;
}

/** README.md#identity-outranks-a-blended-magnitude. `separationArcsec` is null where either position is missing. */
export interface IdentityWitness {
  sourceId: string;
  separationArcsec: number | null;
  /** The named source's Gaia G and the row's printed V: the blend the magnitude gate refused on. */
  gMag: number | null;
  vMag: number | null;
}

/** README.md#the-position-witness: the brightest floor source near the HIP, and how many others were. */
export interface PositionWitness extends NearSource {
  others: number;
  vMag: number | null;
}

/** A position witness that bound its row, and the source Gaia's HIP cross-match names instead, if any. */
export interface BoundPosition {
  witness: PositionWitness;
  disputedBy: string | null;
}

/** What the identity and position witnesses read positions from. */
export interface PositionEvidence {
  hipparcos: (hip: number) => SkyPosition | null;
  /** Null where Gaia publishes no proper motion to carry the source by. */
  gaia: (sourceId: string) => SourceAstrometry | null;
  /** The magnitude floor's kept sources within a second of arc of the HIP's position carried to theirs. */
  keptNearHip: ReadonlyMap<number, readonly NearSource[]>;
}

/** README.md#the-position-witness. */
export function positionWitness(
  hip: number | null, near: readonly NearSource[], wdsXids: BindingEvidence['wdsXids'], vMag: number | null,
): PositionWitness | null {
  if (hip === null) return null;
  const passing = near
    .filter((s) => !isSiblingLetterAttribution(s.sourceId, hip, wdsXids))
    .sort((a, b) => a.gMag - b.gMag || compareSourceIds(a.sourceId, b.sourceId));
  return passing.length === 0 ? null : { ...passing[0], others: passing.length - 1, vMag };
}

function identityWitness(
  hip: number | null, simbad: SimbadSourceIndex, positions: PositionEvidence,
  gMagOf: BindingEvidence['gMagOf'], printed: PrintedV | null,
): IdentityWitness | null {
  const sourceId = hip === null ? null : simbad.byHip.get(hip) ?? null;
  if (hip === null || sourceId === null) return null;
  const at = positions.hipparcos(hip);
  const source = positions.gaia(sourceId);
  return {
    sourceId,
    separationArcsec: at === null || source === null ? null : hipparcosSeparationFromSource(at, source),
    gMag: gMagOf(sourceId),
    vMag: printed?.vMag ?? null,
  };
}

export function rowGateEvidence(
  row: BindingCells,
  evidence: BindingEvidence,
  simbad: SimbadSourceIndex,
  positions: PositionEvidence,
): RowGateEvidence {
  const hip = intCell(row.hip);
  const tycWitness = row.tyc === '' ? null : simbad.byTyc.get(row.tyc) ?? null;
  const printed = printedV({
    printed_hip: hip === null ? [] : [hip],
    tycho2: row.tyc === '' ? [] : [row.tyc],
    gliese: row.gl === '' ? [] : [row.gl],
  }, evidence.printedV);
  return {
    hip, printedV: printed, tycWitness,
    identity: identityWitness(hip, simbad, positions, evidence.gMagOf, printed),
    position: positionWitness(hip, hip === null ? [] : positions.keptNearHip.get(hip) ?? [], evidence.wdsXids, printed?.vMag ?? null),
    evidence,
  };
}

export function bindingClassOf(via: readonly BindingSource[]): DerivedBindingClass {
  if (via.length === 0) return 'none';
  return via.some((s) => s !== 'simbad') ? 'crosswalk_gated' : 'simbad_corroborated';
}

/** The identity witness named a refused candidate and its position did not confirm it. */
export const isUnconfirmed = (d: DerivedBinding): d is DerivedBinding & { identity: IdentityWitness; sourceId: null } =>
  d.identity !== null && d.sourceId === null;

/** Weighs **every** ranked candidate, the winner's losing rivals included,
 *  through `weighBinding`, as `applyBindingGate` does; the component witness is
 *  the one verdict the overlay does not share. Nothing binding is a derived
 *  refusal. */
export function deriveBinding(
  candidates: BindingCandidates,
  gate: RowGateEvidence,
): DerivedBinding {
  const ranked = rankCandidates(candidates);
  const rejected: RejectedCandidate[] = [];
  const gateable = gate.printedV !== null;
  const unweighedNoPulledRow: RankedCandidate[] = [];
  const weighedNullGMag: RankedCandidate[] = [];
  let passed: RankedCandidate | null = null;
  for (const candidate of ranked) {
    const verdict = weighBinding(candidate.sourceId, gate, gate.evidence);
    if (verdict.magnitude === 'null_g') weighedNullGMag.push(candidate);
    if (verdict.magnitude === 'no_pulled_row') unweighedNoPulledRow.push(candidate);
    const reason = rejectionOf(verdict);
    if (reason !== null) rejected.push({ ...candidate, reason });
    else passed ??= candidate;
  }
  const component = passed === null ? componentRescue(rejected, gate) : -1;
  const named = passed === null && component < 0 ? identityNamed(rejected, gate.identity) : null;
  const rescue: { index: number; by: Rescue } | null = component >= 0
    ? { index: component, by: 'component' }
    : named?.confirmed ? { index: named.index, by: 'identity' } : null;
  const [taken] = rescue === null ? [] : rejected.splice(rescue.index, 1);
  const position = passed === null && taken === undefined ? positionRescue(ranked, rejected, gate.position) : null;
  const won = passed ?? taken ?? position?.won ?? null;
  return {
    sourceId: won?.sourceId ?? null,
    via: won?.via ?? [],
    binding: position === null ? bindingClassOf(won?.via ?? []) : 'position_witnessed',
    rescue: position === null ? rescue?.by ?? null : 'position',
    identity: named === null ? null : gate.identity,
    position: position?.bound ?? null,
    ranked, rejected, gateable, unweighedNoPulledRow, weighedNullGMag,
  };
}

/** README.md#the-position-witness. Takes the witness's source off the refusals where a candidate proposed it. */
function positionRescue(
  ranked: readonly RankedCandidate[], rejected: RejectedCandidate[], witness: PositionWitness | null,
): { won: RankedCandidate; bound: BoundPosition } | null {
  if (witness === null) return null;
  const at = rejected.findIndex((r) => r.sourceId === witness.sourceId);
  const [refused] = at < 0 ? [] : rejected.splice(at, 1);
  const hipNames = ranked.find((c) => c.via.includes('hip'))?.sourceId ?? null;
  return {
    won: refused === undefined ? { sourceId: witness.sourceId, via: [] } : { sourceId: refused.sourceId, via: refused.via },
    bound: { witness, disputedBy: hipNames !== null && hipNames !== witness.sourceId ? hipNames : null },
  };
}

/** The refusal the component witness names, or -1. It never outranks a passing candidate (README.md); a sibling
 *  rejection is one the magnitude gate already passed. */
function componentRescue(rejected: readonly RejectedCandidate[], gate: RowGateEvidence): number {
  if (gate.tycWitness === null) return -1;
  return rejected.findIndex((r) => r.reason === 'sibling'
    && r.sourceId === gate.tycWitness
    && !isSiblingLetterAttribution(r.sourceId, gate.hip, gate.evidence.wdsXids, true));
}

/** The magnitude refusal the identity witness names, and whether its position confirms it. */
function identityNamed(
  rejected: readonly RejectedCandidate[], identity: IdentityWitness | null,
): { index: number; confirmed: boolean } | null {
  const index = identity === null ? -1 : rejected.findIndex((r) => r.reason === 'mag' && r.sourceId === identity.sourceId);
  if (identity === null || index < 0) return null;
  return { index, confirmed: identity.separationArcsec !== null && hipparcosNamesSource(identity.separationArcsec) };
}

/** What the astrometry pull has to carry for these rows:
 *  `../../astrometry-request/README.md#the-request-is-a-union-and-why-that-is-not-a-compromise`. */
export function derivationCandidateSourceIds(
  rows: Iterable<BindingCells>,
  tables: BindingTables,
  cns5ByOwnKey: ReadonlyMap<string, Cns5Row>,
  simbad: SimbadSourceIndex,
  keptNearHip: PositionEvidence['keptNearHip'],
): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    const candidates = bindingCandidates(row, tables, cns5ByOwnKey, simbad);
    for (const source of BINDING_SOURCES) {
      const id = candidates[source];
      if (id !== null) ids.add(id);
    }
    const hip = intCell(row.hip);
    for (const near of hip === null ? [] : keptNearHip.get(hip) ?? []) ids.add(near.sourceId);
  }
  return ids;
}

// A manifest row's gaia_source_id derived from committed evidence: four sources,
// two-source consensus first, each candidate through both binding gates.
// See README.md.

import { normaliseGjKey } from '../../record/catalog-pure';
import { printedV } from '../../photometry/v-magnitude-pure';
import {
  isSiblingLetterAttribution,
  rejectionOf,
  weighBinding,
  type BindingEvidence,
  type GateReason,
  type GateRow,
} from './binding-gate-pure';
import type { Cns5Row } from '../../classic-ids/classic-ids-parse';
import { intCell } from '../../../util/tsv/table-pure';
import {
  bareGjKey,
  glKeyForms,
  glKeyVariants,
  type BindingTables,
} from '../../spine/primaries-audit-pure';
import type { SimbadXids } from '../../spectral/spectral-resolve';

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

export function indexSimbadSources(
  bySourceId: ReadonlyMap<string, SimbadXids>,
): SimbadSourceIndex {
  const out: SimbadSourceIndex = { byHip: new Map(), byTyc: new Map(), byGj: new Map() };
  for (const [sourceId, xids] of bySourceId) {
    if (xids.hip !== null) claim(out.byHip, xids.hip, sourceId);
    if (xids.tyc !== null) claim(out.byTyc, xids.tyc, sourceId);
    const gj = normaliseGjKey(xids.gj);
    if (gj === null) continue;
    claim(out.byGj, gj, sourceId);
    const bare = bareGjKey(gj);
    if (bare !== gj) claim(out.byGj, bare, sourceId);
  }
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

export type DerivedBindingClass = 'crosswalk_gated' | 'simbad_corroborated' | 'none';

export interface RejectedCandidate extends RankedCandidate {
  reason: GateReason;
}

export interface DerivedBinding {
  sourceId: string | null;
  via: BindingSource[];
  binding: DerivedBindingClass;
  ranked: RankedCandidate[];
  rejected: RejectedCandidate[];
  /** The row carries a printed V, so the magnitude gate could weigh its
   *  candidates. */
  gateable: boolean;
  /** Candidates weighed with no row in the astrometry pull — the request
   *  under-covering the derivation; pinned at zero. */
  weighedNoGMag: number;
  /** Candidates weighed on a pulled row publishing no `phot_g_mean_mag`. */
  weighedNullGMag: number;
}

/** The evidence a row's candidates are weighed against: the row's own HIP and
 *  printed V, the source SIMBAD files its own TYC under, plus the shared
 *  per-source tables. */
export interface RowGateEvidence extends GateRow {
  /** The component witness — null where SIMBAD files the TYC under no source
   *  or under two (README.md#both-gates-weigh-every-candidate). */
  tycWitness: string | null;
  evidence: BindingEvidence;
}

export function rowGateEvidence(
  row: BindingCells,
  evidence: BindingEvidence,
  simbad: SimbadSourceIndex,
): RowGateEvidence {
  const hip = intCell(row.hip);
  const tycWitness = row.tyc === '' ? null : simbad.byTyc.get(row.tyc) ?? null;
  const printed = printedV({
    printed_hip: hip === null ? [] : [hip],
    tycho2: row.tyc === '' ? [] : [row.tyc],
    gliese: row.gl === '' ? [] : [row.gl],
  }, evidence.printedV);
  return { hip, printedV: printed, tycWitness, evidence };
}

export function bindingClassOf(via: readonly BindingSource[]): DerivedBindingClass {
  if (via.length === 0) return 'none';
  return via.some((s) => s !== 'simbad') ? 'crosswalk_gated' : 'simbad_corroborated';
}

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
  let weighedNoGMag = 0;
  let weighedNullGMag = 0;
  let winner: RankedCandidate | null = null;
  const { evidence } = gate;
  for (const candidate of ranked) {
    const verdict = weighBinding(candidate.sourceId, gate, evidence);
    if (verdict.magnitude === 'null_g') weighedNullGMag++;
    if (verdict.magnitude === 'no_pulled_row') weighedNoGMag++;
    const reason = rejectionOf(verdict);
    if (reason !== null) {
      rejected.push({ ...candidate, reason });
    } else if (winner === null) {
      winner = candidate;
    }
  }
  // The component witness rescues a row the sibling gate left unbound; it never
  // outranks a candidate that passes on its own — see README.md. A sibling
  // rejection is one the magnitude gate already passed.
  if (winner === null && gate.tycWitness !== null) {
    const named = rejected.findIndex((r) => r.reason === 'sibling'
      && r.sourceId === gate.tycWitness
      && !isSiblingLetterAttribution(r.sourceId, gate.hip, evidence.wdsXids, true));
    if (named >= 0) {
      const [rescued] = rejected.splice(named, 1);
      winner = { sourceId: rescued.sourceId, via: rescued.via };
    }
  }
  return {
    sourceId: winner?.sourceId ?? null,
    via: winner?.via ?? [],
    binding: bindingClassOf(winner?.via ?? []),
    ranked, rejected, gateable, weighedNoGMag, weighedNullGMag,
  };
}

/** Every source the derivation could propose for these rows — what the
 *  astrometry pull has to carry a G for, so no candidate reaches the gate
 *  unweighed (`../../astrometry-request/README.md#the-request-is-a-union-and-why-that-is-not-a-compromise`). */
export function derivationCandidateSourceIds(
  rows: Iterable<BindingCells>,
  tables: BindingTables,
  cns5ByOwnKey: ReadonlyMap<string, Cns5Row>,
  simbad: SimbadSourceIndex,
): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    const candidates = bindingCandidates(row, tables, cns5ByOwnKey, simbad);
    for (const source of BINDING_SOURCES) {
      const id = candidates[source];
      if (id !== null) ids.add(id);
    }
  }
  return ids;
}

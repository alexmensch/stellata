// A manifest row's gaia_source_id derived from committed evidence: four sources,
// two-source consensus first, each candidate through both binding gates.
// See README.md § The binding is derived.

import { normaliseGjKey, resolveGaiaSourceId } from '../catalog-pure';
import type { GateVVia, PrintedV } from '../photometry/v-magnitude-pure';
import type { BindingEvidence } from '../classic-ids/classic-id-overlay-pure';
import type { Cns5Row } from '../classic-ids/classic-ids-parse';
import { parseIntOrNull } from '../parse/corpus-tsv';
import {
  bareGjKey,
  glKeyForms,
  glKeyVariants,
  type BindingTables,
  type SimbadXids,
} from '../spine/primaries-audit-pure';

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
   *  and on its bare number. The pull keeps one GJ ident per object, so an
   *  unresolved pair's object (EZ Aqr, holding GJ 866 A, B and C) is keyed
   *  under whichever letter it kept; the bare key is what lets the record's
   *  cell reach it, and the two-claimants guard is what stops a resolved
   *  pair's components answering for each other. */
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
  const hip = parseIntOrNull(row.hip);
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
  const hip = parseIntOrNull(row.hip);
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

export type GateReason = 'mag' | 'sibling';

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
   *  candidates. Without one every candidate passes unweighed, exactly as
   *  `applyBindingGate` skips such overlay rows. */
  gateable: boolean;
  /** Candidates weighed with no row in the astrometry pull — the request
   *  under-covering the derivation; pinned at zero. */
  weighedNoGMag: number;
  /** Candidates weighed on a pulled row publishing no `phot_g_mean_mag`. */
  weighedNullGMag: number;
}

/** The evidence a row's candidates are weighed against: the row's own HIP, its
 *  printed V, plus the shared per-source tables. */
export interface RowGateEvidence {
  hip: number | null;
  vMag: number | null;
  vVia: GateVVia | null;
  evidence: BindingEvidence;
}

/** `printedVBelowHip` supplies the V cascade's lower printed tiers — Tycho-2 on
 *  the row's TYC, then Gliese on its GJ — for a row with no Hipparcos V. */
export function rowGateEvidence(
  row: BindingCells,
  evidence: BindingEvidence,
  printedVBelowHip: (row: BindingCells) => PrintedV | null,
): RowGateEvidence {
  const hip = parseIntOrNull(row.hip);
  const hipV = hip === null ? null : evidence.vMagOfHip(hip);
  if (hipV !== null) return { hip, vMag: hipV, vVia: 'hip', evidence };
  const below = printedVBelowHip(row);
  return { hip, vMag: below?.vMag ?? null, vVia: below?.vVia ?? null, evidence };
}

export function bindingClassOf(via: readonly BindingSource[]): DerivedBindingClass {
  if (via.length === 0) return 'none';
  return via.some((s) => s !== 'simbad') ? 'crosswalk_gated' : 'simbad_corroborated';
}

/** Weigh **every** ranked candidate through `resolveGaiaSourceId` — the same
 *  call `applyBindingGate` makes, so the label side and the record side cannot
 *  drift on what counts as a bad binding — and take the first that passes.
 *  Nothing passing is a derived refusal.
 *
 *  The losers are weighed too, not just the candidates ahead of the winner:
 *  `passingRunnersUp` reads `rejected` to decide whether a row's sources
 *  genuinely disagree, so a candidate left unweighed would count as passing on
 *  evidence never taken and queue a `contested` verdict the gate settles by
 *  itself. */
export function deriveBinding(
  candidates: BindingCandidates,
  gate: RowGateEvidence,
): DerivedBinding {
  const ranked = rankCandidates(candidates);
  const rejected: RejectedCandidate[] = [];
  const gateable = gate.vMag !== null;
  let weighedNoGMag = 0;
  let weighedNullGMag = 0;
  let winner: RankedCandidate | null = null;
  const { evidence } = gate;
  for (const candidate of ranked) {
    if (gateable && evidence.gMagOf(candidate.sourceId) === null) {
      if (evidence.hasPulledRow(candidate.sourceId)) weighedNullGMag++;
      else weighedNoGMag++;
    }
    const verdict = resolveGaiaSourceId(
      candidate.sourceId, gate.hip, null, gate.vMag, evidence.gMagOf, evidence.wdsXids,
    );
    if (verdict.gaiaSourceId === null) {
      rejected.push({ ...candidate, reason: verdict.magRejected ? 'mag' : 'sibling' });
    } else if (winner === null) {
      winner = candidate;
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
 *  unweighed (`../astrometry-request/README.md` § The request is a union). */
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

// The Stage 2 cascade's tiers: ORB6 HIP, AT-HYG-native, SIMBAD cross-ID, CCDM sibling, AT-HYG position. See README.md.

import {
  directionAtEpoch, unitVectorFromRaDec, type SkyPosition, type UnitVector,
} from '../../../src/astro-core/equatorial-basis';
import {
  canonicalCompLetter, componentKey, pairComponentTokens, pairRowKey, type ComponentKey, type PairRowKey,
} from '../component-tokens-pure';
import type { AthygRow } from '../load/athyg-pure';
import type { IdentifierIndices } from '../load/indices-pure';
import type { SimbadWdsXid } from '../load/simbad-pure';
import { measuredOffset, splitComponents, type Orb6Entry, type WdsPair } from '../../wds/wds-pure';
import {
  WDS_PRECISE_COORD_EPOCH, chordSqForTolerance, directionsWithin, predictSecondaryPosition, unitChordSq,
} from '../sky-geometry-pure';
import { athygDirectionAtEpoch, pairAthygMatches } from './athyg-match-pure';
import { ARBITRATION_RUNNERUP_FACTOR } from './binding-audit-pure';
import {
  findOwningPair, own, pairRows, pairsByDiscoverer, unresolvedComponent, working,
  type DecomposedPair, type Draft, type ResolvedComponent,
} from './components-pure';
import {
  buildSystemHipClaims, claimHip, hipClaimedByDisjointLetter, tokensShareIdentity, type HipClaims,
} from './sibling-identity-pure';
import { groupBy } from '../../util/map-buckets-pure';

/** A sibling-identity rejection, one per candidate refused. */
export interface SiblingRejection {
  readonly tier: SiblingRejectionTier;
  readonly wdsId: string;
  readonly component: string;
  readonly hip: number;
}
export const SIBLING_REJECTION_TIERS = ['ccdm_sibling_owned', 'athyg_match_sibling_claimed'] as const;
export type SiblingRejectionTier = (typeof SIBLING_REJECTION_TIERS)[number];

export function groupOrb6ByPair(orb6: readonly Orb6Entry[]): ReadonlyMap<PairRowKey, readonly Orb6Entry[]> {
  return groupBy(orb6, (e) => pairRowKey(e.wdsId, e.components));
}

function gaiaFromAthygViaHip(hip: number, indices: IdentifierIndices): string | null {
  return indices.hipToAthyg.get(hip)?.gaia ?? null;
}

/** ε Equ's ORB6 row lists HIP 103579, ~40° away, for its HIP 103569: 5′
 *  clears any PM / epoch residual and is far inside the smallest such typo. */
export const ORB6_HIP_COORD_SANITY_TOLERANCE_ARCSEC = 300.0;

/** The HIP's AT-HYG row, else its Gaia source, at the WDS coordinate epoch. */
function hipDirection(hip: number, indices: IdentifierIndices): UnitVector | null {
  const row = indices.hipToAthyg.get(hip);
  if (row !== undefined) return athygDirectionAtEpoch(row, WDS_PRECISE_COORD_EPOCH);
  const gaia = indices.hipToGaia.get(hip);
  const astro = gaia === undefined ? undefined : indices.srcToAstrometry.get(gaia);
  if (astro === undefined) return null;
  return directionAtEpoch(
    { raDeg: astro.raDeg, decDeg: astro.decDeg },
    { pmRaMasyr: astro.pmraMasyr, pmDecMasyr: astro.pmdecMasyr },
    astro.refEpoch, WDS_PRECISE_COORD_EPOCH,
  );
}

/** Only a positive mismatch refutes: no pair coord or no HIP position trusts ORB6. */
function orb6HipMatchesPairCoord(hip: number, pair: WdsPair, indices: IdentifierIndices): boolean {
  if (pair.precise === null) return true;
  const dir = hipDirection(hip, indices);
  return dir === null || directionsWithin(
    dir, unitVectorFromRaDec(pair.precise.raDeg, pair.precise.decDeg), ORB6_HIP_COORD_SANITY_TOLERANCE_ARCSEC,
  );
}

/** The HIP-anchored prefix: `orb6_hip` (primaries only — ORB6's one HIP per
 *  row is the primary's), then `athyg_gaia_native` through the HIP. A HIP
 *  failing the coordinate check is dropped outright, so it rides no later
 *  tier either. Unresolved keeps the first surviving HIP for Stage 3. */
export function resolveComponent(
  pair: WdsPair, component: string, isPrimary: boolean,
  orb6ForPair: readonly Orb6Entry[], indices: IdentifierIndices,
): ResolvedComponent {
  const base = unresolvedComponent(pair, component, isPrimary);
  const candidates: number[] = [];
  const hdByHip = new Map<number, number | null>();
  if (isPrimary) {
    for (const e of orb6ForPair) {
      if (e.hip === null || !orb6HipMatchesPairCoord(e.hip, pair, indices)) continue;
      candidates.push(e.hip);
      if (!hdByHip.has(e.hip)) hdByHip.set(e.hip, e.hd);
      const gaia = indices.hipToGaia.get(e.hip);
      if (gaia !== undefined) return { ...base, gaia: own(gaia), resolveVia: 'orb6_hip', hip: own(e.hip), hd: hdByHip.get(e.hip)! };
    }
  }
  for (const hip of candidates) {
    const gaia = gaiaFromAthygViaHip(hip, indices);
    if (gaia !== null) return { ...base, gaia: own(gaia), resolveVia: 'athyg_gaia_native', hip: own(hip), hd: hdByHip.get(hip)! };
  }
  return candidates.length === 0 ? base : { ...base, hip: own(candidates[0]), hd: hdByHip.get(candidates[0])! };
}

/** A SIMBAD cross-ID for a still-unbound component: its DR3 source binds as
 *  `simbad_xid`; a HIP with no source (α Cen's saturation gap) binds the HIP only. */
export function resolveViaSimbad(
  pairs: readonly DecomposedPair[], xids: ReadonlyMap<ComponentKey, SimbadWdsXid>,
): readonly DecomposedPair[] {
  const w = working(pairs);
  for (const c of w.components) {
    if (c.gaia !== null) continue;
    const xid = xids.get(componentKey(c.wdsId, c.component));
    if (xid === undefined) continue;
    if (xid.gaiaSourceId !== null) {
      c.gaia = own(xid.gaiaSourceId);
      c.resolveVia = 'simbad_xid';
    }
    if (c.hip === null && xid.hip !== null) c.hip = own(xid.hip);
  }
  return w.pairs;
}

/** CCDM's candidates are a system's few HIPs, so a window wider than the
 *  position tier's stays unambiguous and absorbs AT-HYG's residual PM error. */
export const CCDM_POSITION_MATCH_TOLERANCE_ARCSEC = 10.0;

export const CCDM_SIBLING_OWNERSHIP_DECISIVENESS = 1 / ARBITRATION_RUNNERUP_FACTOR;

/** wds_id → letter → its best-known position: a primary's precise coord
 *  over a (ρ, θ)-predicted secondary. ρ = 0 predicts nothing. */
export function buildSystemLetterPositions(
  pairs: readonly WdsPair[],
): ReadonlyMap<string, ReadonlyMap<string, SkyPosition>> {
  const out = new Map<string, Map<string, SkyPosition>>();
  const predicted = new Set<string>();
  for (const pair of pairs) {
    if (pair.precise === null) continue;
    const tokens = pairComponentTokens(pair.components);
    if (tokens === null) continue;
    const [primary, secondary] = tokens;
    let letters = out.get(pair.wdsId);
    if (!letters) out.set(pair.wdsId, (letters = new Map()));
    const primaryKey = componentKey(pair.wdsId, primary);
    if (!letters.has(primary) || predicted.has(primaryKey)) {
      letters.set(primary, pair.precise);
      predicted.delete(primaryKey);
    }
    const offset = measuredOffset(pair);
    if (!letters.has(secondary) && offset !== null) {
      letters.set(secondary, predictSecondaryPosition(pair.precise, offset));
      predicted.add(componentKey(pair.wdsId, secondary));
    }
  }
  return out;
}

function siblingLetterOwnsCandidate(
  cand: UnitVector, queryChordSq: number, token: string, partner: string,
  letterPositions: ReadonlyMap<string, SkyPosition>,
): boolean {
  const decisivenessSq = CCDM_SIBLING_OWNERSHIP_DECISIVENESS * CCDM_SIBLING_OWNERSHIP_DECISIVENESS;
  for (const [letter, pos] of letterPositions) {
    if (tokensShareIdentity(letter, token) || tokensShareIdentity(letter, partner)) continue;
    if (unitChordSq(unitVectorFromRaDec(pos.raDeg, pos.decDeg), cand) * decisivenessSq < queryChordSq) return true;
  }
  return false;
}

interface CcdmQuery {
  readonly target: SkyPosition;
  readonly candidates: readonly number[];
  readonly wdsId: string;
  readonly token: string;
  readonly partner: string;
}

/** The candidate HIP nearest the target, skipping one a disjoint letter owns
 *  by geometry or by an existing binding. */
function ccdmCandidateHip(
  q: CcdmQuery, indices: IdentifierIndices, letterPositions: ReadonlyMap<string, SkyPosition> | undefined,
  claims: HipClaims, rejected: SiblingRejection[],
): number | null {
  const threshold = chordSqForTolerance(CCDM_POSITION_MATCH_TOLERANCE_ARCSEC);
  const target = unitVectorFromRaDec(q.target.raDeg, q.target.decDeg);
  let bestHip: number | null = null;
  let best = Infinity;
  for (const hip of q.candidates) {
    const row = indices.hipToAthyg.get(hip);
    if (row === undefined) continue;
    const cand = athygDirectionAtEpoch(row, WDS_PRECISE_COORD_EPOCH);
    const d = unitChordSq(cand, target);
    if (d > threshold) continue;
    const owned = (letterPositions !== undefined && siblingLetterOwnsCandidate(cand, d, q.token, q.partner, letterPositions))
      || hipClaimedByDisjointLetter(claims, q.wdsId, hip, q.token, q.partner);
    if (owned) {
      rejected.push({ tier: 'ccdm_sibling_owned', wdsId: q.wdsId, component: q.token, hip });
      continue;
    }
    if (d < best) {
      best = d;
      bestHip = hip;
    }
  }
  return bestHip;
}

/** Binds the HIP if none is bound yet; a Gaia source through it tags `ccdm_hip`. */
function bindCcdmHip(c: Draft, hip: number, indices: IdentifierIndices): void {
  if (c.hip === null) c.hip = own(hip);
  const gaia = indices.hipToGaia.get(hip) ?? gaiaFromAthygViaHip(hip, indices);
  if (gaia !== null) {
    c.gaia = own(gaia);
    c.resolveVia = 'ccdm_hip';
  }
}

/** The CCDM-sibling tier: the system's CCDM HIPs, nearest the primary's coord
 *  and then the secondary's predicted position, the primary's HIP excluded. A
 *  component already carrying one of them keeps it. ρ = 0 secondaries are
 *  skipped: their prediction sits on the primary. */
export function resolveViaCcdm(
  pairs: readonly DecomposedPair[], indices: IdentifierIndices,
): { pairs: readonly DecomposedPair[]; rejected: readonly SiblingRejection[] } {
  const w = working(pairs);
  const out = w.components;
  const rejected: SiblingRejection[] = [];
  if (indices.ccdmToHips.size === 0) return { pairs: w.pairs, rejected };
  const rows = pairRows(pairs);
  const index = pairsByDiscoverer(rows);
  const letterPositions = buildSystemLetterPositions(rows);
  const claims = buildSystemHipClaims(out);
  const primaryHipByPair = new Map<WdsPair, number>();

  for (const c of out) {
    if (c.gaia !== null || !c.isPrimary) continue;
    const pair = findOwningPair(c, index);
    if (pair === null || pair.precise === null) continue;
    const candidates = indices.ccdmToHips.get(pair.wdsId);
    if (!candidates || candidates.length === 0) continue;
    if (c.hip !== null && candidates.includes(c.hip.value)) {
      primaryHipByPair.set(pair, c.hip.value);
      bindCcdmHip(c, c.hip.value, indices);
      continue;
    }
    const [, partner] = pairComponentTokens(pair.components)!;
    const hip = ccdmCandidateHip(
      { target: pair.precise, candidates, wdsId: c.wdsId, token: c.component, partner },
      indices, letterPositions.get(c.wdsId), claims, rejected,
    );
    if (hip === null) continue;
    primaryHipByPair.set(pair, hip);
    bindCcdmHip(c, hip, indices);
    claimHip(claims, c.wdsId, hip, c.component);
  }

  for (const c of out) {
    if (c.gaia !== null || c.isPrimary) continue;
    const pair = findOwningPair(c, index);
    const offset = pair === null ? null : measuredOffset(pair);
    if (pair === null || pair.precise === null || offset === null) continue;
    const candidates = indices.ccdmToHips.get(pair.wdsId);
    if (!candidates || candidates.length === 0) continue;
    const primaryHip = primaryHipByPair.get(pair);
    const narrowed = candidates.filter((h) => h !== primaryHip);
    if (narrowed.length === 0) continue;
    if (c.hip !== null && narrowed.includes(c.hip.value)) {
      bindCcdmHip(c, c.hip.value, indices);
      continue;
    }
    const [primaryToken] = splitComponents(pair.components)!;
    const hip = ccdmCandidateHip(
      {
        target: predictSecondaryPosition(pair.precise, offset),
        candidates: narrowed, wdsId: c.wdsId,
        token: canonicalCompLetter(primaryToken, c.component), partner: primaryToken,
      },
      indices, letterPositions.get(c.wdsId), claims, rejected,
    );
    if (hip === null) continue;
    bindCcdmHip(c, hip, indices);
    claimHip(claims, c.wdsId, hip, c.component);
  }
  return { pairs: w.pairs, rejected };
}

export function resolveViaPosition(
  pairs: readonly DecomposedPair[], athyg: readonly AthygRow[],
): { pairs: readonly DecomposedPair[]; rejected: readonly SiblingRejection[] } {
  const { matches, siblingClaimed } = pairAthygMatches(pairs, athyg, { skip: (_i, c) => c.gaia !== null });
  const w = working(pairs);
  const out = w.components;
  for (const m of matches) {
    if (m.origin.kind !== 'own') continue;
    const c = out[m.componentIdx];
    const row = athyg[m.athygIdx];
    if (c.athyg === null) c.athyg = own(row);
    if (c.hip === null && row.hip !== null) c.hip = own(row.hip);
    if (row.gaia !== null) {
      c.gaia = own(row.gaia);
      c.resolveVia = 'athyg_gaia_native';
    }
  }
  const rejected = siblingClaimed.map((s): SiblingRejection => ({
    tier: 'athyg_match_sibling_claimed', wdsId: out[s.componentIdx].wdsId, component: out[s.componentIdx].component, hip: s.hip,
  }));
  return { pairs: w.pairs, rejected };
}

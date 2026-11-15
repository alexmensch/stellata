// Binary inference and the wings-bit claimants. See README.md.

import {
  VAR_TYPE_ECLIPSING,
  type DistVia,
} from '../../../src/catalog-format/record/catalog-pure';
import { ascending } from '../../../src/astro-core/order-pure';
import type { MultiplicityCounts } from './multiplicity-stage-pure';
import type { Sorted } from '../record/record-phase';

// Pairs within this 3D distance are flagged as a physical binary/multiple
// system. 0.005 pc ≈ 1030 AU — wide-binary territory. Gaia resolves most
// bound pairs wider than ~0.5 arcsec so this captures the visually-
// renderable cases.
export const BINARY_MAX_SEP_PC = 0.005;

// Structural type of a star record consumed by `inferBinaries`. The build
// script's full Star type extends this; the helper only reads/writes the
// fields named here.
export interface BinaryStar {
  x: number;
  y: number;
  z: number;
  absmag: number;
  companionIdx: number;
}

// Index of the brightest (lowest absmag) star in `indices`, or -1 when
// empty. Single point of truth for the "primary = brightest of group"
// convention every claimant of FLAG_BINARY_PRIMARY shares.
export function pickBrightest(
  stars: readonly Pick<BinaryStar, 'absmag'>[],
  indices: readonly number[],
): number {
  let bestIdx = -1;
  let bestMag = Infinity;
  for (const i of indices) {
    const m = stars[i].absmag;
    if (m < bestMag) {
      bestMag = m;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** The records one claimant picks as their system's primary, with the counts it reports. */
export interface PrimaryClaims<C> {
  readonly claims: readonly number[];
  readonly counts: C;
}

/** A claimant, handed every record an earlier claimant took. Holds no reference to it past the call. */
export type PrimaryClaimant<C> = (claimed: ReadonlySet<number>) => PrimaryClaims<C>;

/** README.md#binary-primary-claims. */
export function binaryPrimaries<T extends readonly unknown[]>(
  ...claimants: { readonly [K in keyof T]: PrimaryClaimant<T[K]> }
): { readonly primaries: ReadonlySet<number>; readonly counts: T } {
  const claimed = new Set<number>();
  const counts = claimants.map((claimant: PrimaryClaimant<unknown>) => {
    const r = claimant(claimed);
    for (const i of r.claims) claimed.add(i);
    return r.counts;
  });
  return { primaries: claimed, counts: counts as unknown as T };
}

// Vetoes a freshly-picked primary before it is claimed — the CCDM
// optical-double gate (see isOpticalDoubleMember).
export type SuppressPredicate = (
  primaryIdx: number,
  memberIndices: readonly number[],
) => boolean;

/** README.md#ccdm-double-star-cross-match. */
export function groupPrimaryClaims(
  stars: readonly Pick<BinaryStar, 'absmag'>[],
  groups: readonly (readonly number[])[],
  claimed: ReadonlySet<number>,
  suppress?: SuppressPredicate,
): PrimaryClaims<{ systems: number; flagged: number; suppressed: number }> {
  const claims: number[] = [];
  const mine = new Set<number>();
  let suppressed = 0;
  for (const indices of groups) {
    if (indices.some((i) => claimed.has(i) || mine.has(i))) continue;
    const bestIdx = pickBrightest(stars, indices);
    if (bestIdx === -1) continue;
    if (suppress?.(bestIdx, indices)) { suppressed++; continue; }
    claims.push(bestIdx);
    mine.add(bestIdx);
  }
  return { claims, counts: { systems: groups.length, flagged: claims.length, suppressed } };
}

// When the same HIP appears on multiple rows (rare; binary companions sharing
// an identifier) the FIRST occurrence wins, so against the apparent-V-sorted
// records the value is the apparently brightest row. Shared
// between the stick-figure resolver and the CCDM doubles pass so the two never
// disagree on a duplicate.
export function buildHipToIndex(
  stars: Sorted<{ readonly hip: number | null }>,
): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i < stars.length; i++) {
    const h = stars[i].hip;
    if (h !== null && h > 0 && !m.has(h)) m.set(h, i);
  }
  return m;
}

/** Each group's in-catalogue records, ascending and deduplicated; a group with none is dropped. */
export function resolveGroups(
  groups: Iterable<Iterable<number>>,
  hipToIndex: ReadonlyMap<number, number>,
): number[][] {
  const out: number[][] = [];
  for (const hips of groups) {
    const indices = [...new Set([...hips].flatMap((h) => hipToIndex.get(h) ?? []))].sort(ascending);
    if (indices.length > 0) out.push(indices);
  }
  return out;
}

// ---- CCDM optical-double suppression ------------------------------------

// Bound stellar pairs sit within the Galactic tidal-disruption limit for
// field binaries (~1 pc); a wider 3D split is a line-of-sight optical
// double. Mirrors the binaries pipeline's Stage-5 SEPARATION_LIMIT_PC.
export const OPTICAL_DOUBLE_MIN_SEP_PC = 1.0;

// Fields isOpticalDoubleMember reads. Star satisfies this structurally.
/** Whether a record's distance rests on a Gaia parallax, raw or through the
 *  Bailer-Jones 2021 (/data/papers/index.md#bailerjones2021) posterior
 *  over it. The optical-double suppression needs it
 *  because a separation is only trustworthy when both stars' distances are: a
 *  Hipparcos or courier parallax carries error bars wide enough to put a bound
 *  pair kiloparsecs apart, which reads as an optical double. */
export function hasGaiaQualityDistance(distVia: DistVia | null): boolean {
  return distVia === 'gaia_dr3_inversion' || distVia === 'bailer_jones';
}

export interface OpticalDoubleStar {
  absmag: number;
  x: number;
  y: number;
  z: number;
  hip: number | null;
  gaiaSourceId: string | null;
  /** The tier this record's own distance came from — see `hasGaiaQualityDistance`.
   *  Was the spine's editorial `dist_src` cell until the parallax cascade gave
   *  the build a first-hand answer to the same question. */
  distVia: DistVia | null;
  varType: number;
}

export interface OpticalDoubleContext {
  // HIPs / Gaia source_ids that are a component of a kept physical pair in
  // data/binaries/multiples.tsv (Stage 5 classified them bound), unioned
  // with the curated KNOWN_VISUAL_DOUBLES. A primary in either set has
  // independent physical evidence — its wings stand regardless of CCDM
  // group geometry.
  physicalHips: ReadonlySet<number>;
  physicalGaia: ReadonlySet<string>;
  minSepPc: number;
}

// True when a CCDM group member is a line-of-sight optical double with no
// independent physical evidence: the wings pass vetoes its picked primary on
// it, and system membership drops each member it holds for. See
// /scripts/catalog/multiplicity/README.md#ccdm-double-star-cross-match.
//
// Fires only on positive evidence the asserted pair is optical — the nearest
// same-group sibling with a Gaia-quality distance sits farther than
// ctx.minSepPc in 3D. It never fires on mere absence of physical evidence, so
// a noisy parallax can't strip a real pair. Returns false when any holds:
//  - the member is a component of a kept physical pair, or eclipsing — the
//    geometric claim is honoured upstream, by groupPrimaryClaims skipping a
//    group with a claimed member;
//  - the member lacks a Gaia-quality distance (separation untrustworthy);
//  - no same-group sibling with a Gaia-quality distance exists to measure.
export function isOpticalDoubleMember(
  memberIdx: number,
  memberIndices: readonly number[],
  stars: readonly OpticalDoubleStar[],
  ctx: OpticalDoubleContext,
): boolean {
  const p = stars[memberIdx];
  if (p.varType === VAR_TYPE_ECLIPSING) return false;
  if (p.hip !== null && ctx.physicalHips.has(p.hip)) return false;
  if (p.gaiaSourceId !== null && ctx.physicalGaia.has(p.gaiaSourceId)) return false;
  if (!hasGaiaQualityDistance(p.distVia)) return false;

  let nearestSq = Infinity;
  for (const j of memberIndices) {
    if (j === memberIdx) continue;
    const q = stars[j];
    if (!hasGaiaQualityDistance(q.distVia)) continue;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const dz = q.z - p.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < nearestSq) nearestSq = d2;
  }
  if (nearestSq === Infinity) return false;
  return nearestSq > ctx.minSepPc * ctx.minSepPc;
}

// Spatial-grid nearest-neighbour pass. For each star, find its nearest
// neighbour within BINARY_MAX_SEP_PC and record it as `companionIdx`.
// `companionIdx` is the **directed** nearest neighbour (A's nearest may
// be B while B's nearest is some third star C); the renderer reads it
// as "the partner for SVG disc-mask cutouts and chart-mode wings,"
// which is well-defined even when the relationship is one-way.
//
// Mutates `stars[i].companionIdx` in place. `mutual` is what the geometric
// claimant (mutualPairClaims) claims from.
export function inferBinaries(
  stars: Sorted<BinaryStar>,
): { counts: Pick<MultiplicityCounts, 'binaryPairs' | 'binaryMutualPairs'>; mutual: (readonly [number, number])[] } {
  const cell = BINARY_MAX_SEP_PC;
  const cellInv = 1 / cell;
  const grid = new Map<number, number[]>();
  const n = stars.length;

  const hashKey = (ix: number, iy: number, iz: number): number =>
    ix * 73856093 + iy * 19349663 + iz * 83492791;

  for (let i = 0; i < n; i++) {
    const s = stars[i];
    const ix = Math.floor(s.x * cellInv);
    const iy = Math.floor(s.y * cellInv);
    const iz = Math.floor(s.z * cellInv);
    const key = hashKey(ix, iy, iz);
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
  }

  const sepSq = BINARY_MAX_SEP_PC * BINARY_MAX_SEP_PC;
  let pairs = 0;

  for (let i = 0; i < n; i++) {
    const s = stars[i];
    const ix = Math.floor(s.x * cellInv);
    const iy = Math.floor(s.y * cellInv);
    const iz = Math.floor(s.z * cellInv);
    let bestIdx = -1;
    let bestSq = sepSq;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(hashKey(ix + dx, iy + dy, iz + dz));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j === i) continue;
            const t = stars[j];
            const dxv = t.x - s.x;
            const dyv = t.y - s.y;
            const dzv = t.z - s.z;
            const d2 = dxv * dxv + dyv * dyv + dzv * dzv;
            if (d2 < bestSq) {
              bestSq = d2;
              bestIdx = j;
            }
          }
        }
      }
    }
    if (bestIdx !== -1) {
      stars[i].companionIdx = bestIdx;
      pairs++;
    }
  }

  const mutual = mutualPairs(stars);
  return { counts: { binaryPairs: pairs, binaryMutualPairs: mutual.length }, mutual };
}

/** Each A↔B where each is the other's directed nearest (`companionIdx`), once, as [lower index, higher]. */
export function mutualPairs(stars: readonly Pick<BinaryStar, 'companionIdx'>[]): (readonly [number, number])[] {
  const out: (readonly [number, number])[] = [];
  for (let i = 0; i < stars.length; i++) {
    const j = stars[i].companionIdx;
    if (j > i && stars[j].companionIdx === i) out.push([i, j]);
  }
  return out;
}

/** The geometric claim: the brighter member of each **mutual** pair (A's nearest is B AND B's nearest is A).
 *  Mutual-only avoids over-flagging in dense clusters where one star's nearest is a third star paired with
 *  someone else. Mutual pairs are disjoint, so no two claims collide. */
export function mutualPairClaims(
  stars: readonly Pick<BinaryStar, 'absmag'>[],
  mutual: readonly (readonly [number, number])[],
): number[] {
  return mutual.map((pair) => pickBrightest(stars, pair));
}

/** Every eclipsing record no earlier claimant took (../parse/gcvs/README.md): eclipsers surface as multi-star
 *  systems, not intrinsic-variable rings. */
export function eclipsingClaims(
  stars: Sorted<{ readonly varType: number }>,
  claimed: ReadonlySet<number>,
): PrimaryClaims<Pick<MultiplicityCounts, 'eclipsingWinged'>> {
  const claims: number[] = [];
  stars.forEach((s, i) => {
    if (s.varType === VAR_TYPE_ECLIPSING && !claimed.has(i)) claims.push(i);
  });
  return { claims, counts: { eclipsingWinged: claims.length } };
}

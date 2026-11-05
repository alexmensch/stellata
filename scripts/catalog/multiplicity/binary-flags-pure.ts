// Geometric binary inference and the CCDM doubles flag with its optical-double
// gate. See README.md.

import {
  FLAG_BINARY_PRIMARY,
  VAR_TYPE_ECLIPSING,
  type DistVia,
} from '../../../src/catalog-format/record/catalog-pure';

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
  flags: number;
  companionIdx: number;
}

// Index of the brightest (lowest absmag) star in `indices`, or -1 when
// empty. Single point of truth for the "primary = brightest of group"
// convention shared by every binary-flagging path (geometric mutual pairs
// in inferBinaries; CCDM groups + curated doubles in applyDoublesFlag).
export function pickBrightest(
  stars: Pick<BinaryStar, 'absmag'>[],
  indices: number[],
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

// Pick the brightest star of `indices` and OR FLAG_BINARY_PRIMARY onto it.
// Returns the picked index, or -1 if the group is empty.
//
// Idempotent: re-running on a group whose primary is already flagged
// produces the same flag bits.
export function markPrimary(
  stars: Pick<BinaryStar, 'absmag' | 'flags'>[],
  indices: number[],
): number {
  const bestIdx = pickBrightest(stars, indices);
  if (bestIdx === -1) return -1;
  stars[bestIdx].flags |= FLAG_BINARY_PRIMARY;
  return bestIdx;
}

// Vetoes a freshly-picked primary before its FLAG_BINARY_PRIMARY bit is
// set — the CCDM optical-double gate (see isOpticalDoublePrimary).
export type SuppressPredicate = (
  primaryIdx: number,
  memberIndices: number[],
) => boolean;

// Like markPrimary, but a no-op when any star in `indices` already carries
// FLAG_BINARY_PRIMARY. Used by the CCDM pass: a star flagged by
// inferBinaries' mutual-pair pick should not get re-picked here, since
// the two passes can disagree on which of a triple is "primary" (e.g. a
// non-mutual {A, B, C} where the geometric pair is (B, C) but A is
// brightest in the CCDM group). Honouring the existing pick keeps the
// "at most one primary per physical system" contract — re-flagging would
// produce two wings glyphs for the same system.
//
// `suppress`, when supplied, vetoes the fresh flag after the primary is
// picked but before the bit is set (the CCDM optical-double gate). The
// already-flagged short-circuit runs first, so a primary the geometric
// pass already winged is never subject to suppression.
//
// Returns the picked index, -1 if no in-catalog members, -2 if a member
// was already flagged, or -3 if `suppress` vetoed the pick.
export function markPrimaryIfUnflagged(
  stars: Pick<BinaryStar, 'absmag' | 'flags'>[],
  indices: number[],
  suppress?: SuppressPredicate,
): number {
  if (indices.length === 0) return -1;
  for (const i of indices) {
    if ((stars[i].flags & FLAG_BINARY_PRIMARY) !== 0) return -2;
  }
  const bestIdx = pickBrightest(stars, indices);
  if (bestIdx === -1) return -1;
  if (suppress?.(bestIdx, indices)) return -3;
  stars[bestIdx].flags |= FLAG_BINARY_PRIMARY;
  return bestIdx;
}

// Apply FLAG_BINARY_PRIMARY across an iterable of HIP-indexed groups. Each
// group's brightest in-catalog component (lowest absmag) gets the bit,
// idempotent with any pre-existing flags from `inferBinaries` (the
// geometric mutual-pair pass can have already marked one member). Groups
// with no in-catalog members are silently skipped.
//
// The `groups` iterable is the union of CCDM groups parsed from the
// Hipparcos cross-reference and the curated `KNOWN_VISUAL_DOUBLES`
// overrides — the caller (build-catalog) constructs the union; this
// helper just walks it.
//
// `suppress` (optional) is forwarded to `markPrimaryIfUnflagged` to veto
// optical doubles — see isOpticalDoublePrimary.
//
// Returns:
//   systems     — count of groups that resolved at least one in-catalog HIP.
//   flagged     — count of groups where this pass set a fresh primary
//                 (i.e. excludes groups whose primary was already set by a
//                 prior pass).
//   suppressed  — count of groups whose fresh primary was vetoed as an
//                 optical double.
//
// Mutates `stars[i].flags` in place via `markPrimaryIfUnflagged`. Pure
// otherwise — does not read or write any other fields.
export interface DoublesStar { absmag: number; flags: number; hip: number | null; }

// When the same HIP appears on multiple rows (rare; binary companions sharing
// an identifier) the FIRST occurrence wins, so against the absmag-sorted star
// array build-catalog.ts produces the value is the brightest row. Shared
// between the stick-figure resolver and the CCDM doubles pass so the two never
// disagree on a duplicate.
export function buildHipToIndex(
  stars: { hip: number | null }[],
): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i < stars.length; i++) {
    const h = stars[i].hip;
    if (h !== null && h > 0 && !m.has(h)) m.set(h, i);
  }
  return m;
}

export function applyDoublesFlag(
  stars: DoublesStar[],
  groups: Iterable<Iterable<number>>,
  hipToIndex: Map<number, number>,
  suppress?: SuppressPredicate,
): { systems: number; flagged: number; suppressed: number } {
  let systems = 0;
  let flagged = 0;
  let suppressed = 0;
  for (const hips of groups) {
    const indices: number[] = [];
    for (const h of hips) {
      const idx = hipToIndex.get(h);
      if (idx !== undefined) indices.push(idx);
    }
    if (indices.length === 0) continue;
    systems++;
    const picked = markPrimaryIfUnflagged(stars, indices, suppress);
    if (picked >= 0) flagged++;
    else if (picked === -3) suppressed++;
  }
  return { systems, flagged, suppressed };
}

// ---- CCDM optical-double suppression ------------------------------------

// Bound stellar pairs sit within the Galactic tidal-disruption limit for
// field binaries (~1 pc); a wider 3D split is a line-of-sight optical
// double. Mirrors the binaries pipeline's Stage-5 SEPARATION_LIMIT_PC.
export const OPTICAL_DOUBLE_MIN_SEP_PC = 1.0;

// Fields isOpticalDoublePrimary reads. Star satisfies this structurally.
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

// True when a CCDM group's picked primary should NOT be winged: it's an
// optical double with no independent physical evidence. See
// /scripts/catalog/multiplicity/README.md#ccdm-double-star-cross-match.
//
// Suppression fires only on positive evidence the asserted pair is optical
// — the nearest same-group sibling with a Gaia-quality distance sits
// farther than ctx.minSepPc in 3D. It never fires on mere absence of
// physical evidence, so a noisy parallax can't strip real wings. Keeps the
// wings (returns false) when any holds:
//  - the primary is a component of a kept physical pair, or eclipsing
//    (extrinsic wings earned) — the geometric mutual-pair flag is honoured
//    upstream by markPrimaryIfUnflagged's already-flagged short-circuit;
//  - the primary lacks a Gaia-quality distance (separation untrustworthy);
//  - no same-group sibling with a Gaia-quality distance exists to measure.
export function isOpticalDoublePrimary(
  primaryIdx: number,
  memberIndices: number[],
  stars: OpticalDoubleStar[],
  ctx: OpticalDoubleContext,
): boolean {
  const p = stars[primaryIdx];
  if (p.varType === VAR_TYPE_ECLIPSING) return false;
  if (p.hip !== null && ctx.physicalHips.has(p.hip)) return false;
  if (p.gaiaSourceId !== null && ctx.physicalGaia.has(p.gaiaSourceId)) return false;
  if (!hasGaiaQualityDistance(p.distVia)) return false;

  let nearestSq = Infinity;
  for (const j of memberIndices) {
    if (j === primaryIdx) continue;
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
// The `0x10` flag is stricter: set only on the brighter member of a
// **mutual** pair (A's nearest is B AND B's nearest is A). The chart-
// mode wings glyph is anchored on `0x10`, so mutual-only avoids
// over-flagging in dense clusters where one star's nearest happens to
// be a third star that's actually paired with someone else.
//
// Mutates `stars[i].companionIdx` and `stars[i].flags` in place.
// Returns counts for the build-time log line:
//   pairs        — total directed companion assignments
//   mutualPairs  — undirected mutual pairs (each counted once); also
//                  equals the count of FLAG_BINARY_PRIMARY bits set,
//                  since we mark exactly one primary per mutual pair
export function inferBinaries(
  stars: BinaryStar[],
): { pairs: number; mutualPairs: number } {
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

  // Second pass: identify mutual pairs (A↔B where each is the other's
  // directed nearest) and flag the brighter member as primary. Iterate
  // i < j to count each pair exactly once.
  let mutualPairs = 0;
  for (let i = 0; i < n; i++) {
    const j = stars[i].companionIdx;
    if (j < 0 || j <= i) continue;
    if (stars[j].companionIdx !== i) continue;
    mutualPairs++;
    markPrimary(stars, [i, j]);
  }

  return { pairs, mutualPairs };
}

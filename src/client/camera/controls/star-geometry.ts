// Pure-math star-geometry helpers (angular diameter, disc-size,
// variability headroom). The vertex shader keeps its own copy of
// `physSizePx`; the variability-headroom rule lives only here.

import type * as THREE from 'three';

// Pixel-per-radian conversion. Mirrors the shader's
// `viewport.y / max(fovYRad, 1e-9)`. Floor on fovYRad keeps the divide
// finite in the singular case where the camera FOV is briefly written
// as zero during a transition.
export function angularToPx(viewport_y: number, fovYRad: number): number {
  return viewport_y / Math.max(fovYRad, 1e-9);
}

// Angular diameter in pixels under `θ = 2·atan(R / d)`, given a
// precomputed pixels-per-radian factor. The shared core of physSizePx
// (stars) and the extended-object rendered-size helpers (molecular
// clouds, Local Group, boundary shells) — each caller supplies its own
// dCam floor before calling.
export function angularDiameterPx(radiusPc: number, dCamPc: number, angularToPxValue: number): number {
  return 2 * Math.atan(radiusPc / dCamPc) * angularToPxValue;
}

// Star disc pixel diameter. `radiusFactor` modulates `R` for variable-star
// pulsation (1 for non-variables; ρ^(±0.5) at the peak/trough of the
// per-type radius swing). The shader's physSize calc must produce the
// same value for the same inputs — keep them in sync.
export function physSizePx(
  R_pc: number,
  dCam_pc: number,
  viewport_y: number,
  fovYRad: number,
  radiusFactor = 1,
): number {
  return angularDiameterPx(R_pc * radiusFactor, dCam_pc, angularToPx(viewport_y, fovYRad));
}

// Per-star variability factor on physical radius. A non-variable returns
// 1. A variable returns √ρ — the peak radius factor of the shader's
// `radiusFactor = ρ^(−0.5·cos 2πφ)` (maximum at the radius peak, φ = 0.5),
// where ρ is the per-type peak-to-peak disc-swing ratio. Drives the orbit
// floor and parking-distance calibration so the pulse peak hits the same
// screen-fill fraction every star does. Returns 1 for rows the GCVS pass
// couldn't model (no period / no amplitude) so the renderer treats them
// as static.
export function peakAmplitudeFactor(
  pulsRho: number,
  amplitudeMag: number,
  periodDays: number,
): number {
  return periodDays > 0 && amplitudeMag > 0 ? Math.sqrt(pulsRho) : 1;
}

// Sub-pixel magnitude bias in `pickScore`. A 1-mag-fainter candidate is
// treated as `PICK_MAG_BIAS_PX_PER_MAG` pixels farther from the cursor;
// a 4-mag-fainter candidate is 0.2 px farther. Sized so any visible
// `pxDist` gap (≥ 1 px) dominates while two coincident catalog rows
// (Alula Australis A/B at the same x/y/z) still tiebreak by brightness.
export const PICK_MAG_BIAS_PX_PER_MAG = 0.05;

// Floor on the hit radius every layer derives from a drawn diameter.
// Tiny chart-mode discs (down to 1–2 px) leave a sub-pixel target that
// the cursor can easily miss even when visually right on top of the
// object. Floor the disc-test radius to a value the cursor can
// realistically land within. Hoisted here (away from stellata.ts) so the
// star and planet pick paths share a single source.
export const MIN_DISC_HIT_RADIUS_PX = 4;

// The grab radius. Hover and click MUST share it — it floors the
// enclosure, so two values rank the same candidates differently
// (`../../hover/README.md#architecture`).
export const PICK_THRESHOLD_PX = 7;

// Hit radius for a drawn diameter. The floor applies to the
// resolved radius as much as the prefilter's, so a star dimmed to a
// sub-pixel disc stays as reachable as a chart-mode one.
export function discHitRadiusPx(drawnDiameterPx: number): number {
  return Math.max(drawnDiameterPx * 0.5, MIN_DISC_HIT_RADIUS_PX);
}

// Pick score: (pxDist + sub-pixel appMag bias) over the candidate's own
// hit radius. Normalising the WHOLE numerator is what leaves same-size
// candidates ranking as they did: an equal divisor cancels. Why the
// divisor, and why camera distance is not a tiebreaker: README.md#ranking-a-pick.
export function pickScore(pxDist: number, appMag: number, hitRadius: number): number {
  return (pxDist + appMag * PICK_MAG_BIAS_PX_PER_MAG) / hitRadius;
}

// One projected pick candidate the caller has already accepted.
// `hitRadius` is caller-computed because it depends on rendered disc
// size. Pure-data shape so the reducer below stays unit-testable without
// a Three.js scene.
export type PickCandidate = {
  idx: number;
  pxDist: number;
  hitRadius: number;
  /** Set by a layer whose own hit test IS the enclosure test, where
   *  `pxDist` can exceed `hitRadius` on a near-side lobe and the radius
   *  reports size alone (`../../molecular-clouds/README.md`). */
  enclosed?: boolean;
};

// Star-specific candidate. Carries `appMag` so the sub-pixel
// brightness bias in `pickScore` can tiebreak coincident catalog
// rows (Alula Australis A/B in AT-HYG sharing x/y/z), and
// `cameraDistancePc` so the hover path (`pickStarHit`) can ride the
// distance through to its `HoverHit` without re-walking the projection
// for the winner. The click path (`pickStar`) ignores the field.
export type StarPickCandidate = PickCandidate & {
  appMag: number;
  cameraDistancePc: number;
  anchorLocal: THREE.Vector3;
};

// The on-screen half-extent a cursor can be inside for this candidate
// (`../../hover/README.md` Rule 3). The rounding is load-bearing: two
// objects the user sees as the same size can differ by a thousandth of a
// pixel, and ranking on that would let an invisible difference decide the
// pick. Equal to the pixel means peers, and peers fall to the tiebreak.
export function enclosureRadiusPx(hitRadius: number, pixelThreshold: number): number {
  return Math.round(Math.max(hitRadius, pixelThreshold));
}

// Returns the candidate, not its idx, so callers read the winner's
// extension fields without re-walking the projection.
export type PickResult<T extends PickCandidate> = {
  candidate: T;
  enclosureRadiusPx: number;
  depthScore: number;
};

// Reduce a candidate list to the winner, or null: tightest enclosure,
// then `scoreFn` between equals (README.md#ranking-a-pick). A candidate
// encloses the cursor when `pxDist <= enclosureRadiusPx(...)` or when it
// sets `enclosed`. Every caller's radius comes from `discHitRadiusPx`, so
// the default scorer's divisor is floored well above zero.
export function pickFromCandidates<T extends PickCandidate>(
  candidates: Iterable<T>,
  pixelThreshold: number,
  scoreFn: (c: T) => number = (c) => c.pxDist / c.hitRadius,
): PickResult<T> | null {
  let best: T | null = null;
  let bestRadius = Infinity;
  let bestScore = Infinity;
  for (const c of candidates) {
    const radius = enclosureRadiusPx(c.hitRadius, pixelThreshold);
    if (c.enclosed !== true && c.pxDist > radius) continue;
    const score = scoreFn(c);
    if (radius < bestRadius || (radius === bestRadius && score < bestScore)) {
      best = c;
      bestRadius = radius;
      bestScore = score;
    }
  }
  if (best === null) return null;
  return { candidate: best, enclosureRadiusPx: bestRadius, depthScore: bestScore };
}

/** What a `Resolve` reports about one candidate once the expensive
 *  per-star terms (dust extinction) have actually been fetched. */
export type ResolvedCandidate = {
  /** False when the renderer puts no pixel on screen for it. */
  visible: boolean;
  /** Hit radius recomputed against those terms — a dimmer star draws a
   *  smaller disc, so this only ever shrinks. */
  hitRadius: number;
};

/**
 * The same tightest-enclosure contract as `pickFromCandidates`, but each
 * candidate is confirmed through `resolve` before it can win, and only as
 * far down the order as it takes to find a winner.
 *
 * Lazy so `resolve` runs at most once per candidate that could win, not
 * once per candidate (README.md#pickerts.ts).
 *
 * Callers MUST pass a `hitRadius` that is an upper bound of the resolved
 * one, or the walk skips a candidate that would have enclosed the cursor.
 * The score normalises against that bound and never the resolved radius —
 * scoring on the resolved one would resolve every candidate to sort them,
 * which is the readback the laziness exists to avoid.
 */
export function pickFromCandidatesResolved<T extends PickCandidate>(
  candidates: Iterable<T>,
  pixelThreshold: number,
  scoreFn: (c: T) => number,
  resolve: (c: T) => ResolvedCandidate,
): PickResult<T> | null {
  const eligible: T[] = [];
  for (const c of candidates) {
    if (c.pxDist <= enclosureRadiusPx(c.hitRadius, pixelThreshold)) eligible.push(c);
  }
  eligible.sort((a, b) => {
    const ra = enclosureRadiusPx(a.hitRadius, pixelThreshold);
    const rb = enclosureRadiusPx(b.hitRadius, pixelThreshold);
    return ra === rb ? scoreFn(a) - scoreFn(b) : ra - rb;
  });
  for (const c of eligible) {
    const r = resolve(c);
    if (!r.visible) continue;
    const radius = enclosureRadiusPx(r.hitRadius, pixelThreshold);
    if (c.pxDist > radius) continue;
    return { candidate: c, enclosureRadiusPx: radius, depthScore: scoreFn(c) };
  }
  return null;
}

// Solve for camera distance `d` such that a star of radius `R_pc`
// (physical, in pc) fills `targetFrac` of `min(viewport.x, viewport.y)`
// at the current FOV. Symbolically:
//   targetFrac · fovMinor = 2·atan(R / d)
//   d = R / tan(targetFrac · fovMinor / 2)
// The bare angular solve, which the park distances take directly. It is
// NOT the manual-zoom floor: that is `orbitFloorAtFill` in star-physics.ts,
// which holds this result outside the body's surface.
export function distAtFillFraction(
  R_pc: number,
  fovMinorRad: number,
  targetFrac: number,
): number {
  return R_pc / Math.tan((targetFrac * fovMinorRad) / 2);
}

// `[start, end)` half-open slice of `sortedDist` covering values in
// `[minDist, maxDist]`. Lower-bound + upper-bound binary searches.
// Shared across all consumers that scan stars in a Sol-distance band:
// the star pick path (windowed `[minDistSol, maxDistSol]` band), and
// the core-mask gate (triangle-inequality bracket around the camera's
// own Sol distance). Single source so the bracket logic isn't typed
// twice.
export function sortedDistRange(
  sortedDist: Float32Array,
  minDist: number,
  maxDist: number,
): { start: number; end: number } {
  const n = sortedDist.length;
  let lo = 0, hi = n;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if (sortedDist[m] < minDist) lo = m + 1; else hi = m;
  }
  const start = lo;
  hi = n;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if (sortedDist[m] <= maxDist) lo = m + 1; else hi = m;
  }
  return { start, end: lo };
}

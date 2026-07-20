// Pure-math star-geometry helpers (angular diameter, disc-size,
// variability headroom). The vertex shader keeps its own copy of
// `physSizePx`; the variability-headroom rule lives only here.

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

// Floor on the prime-disc hit radius for any layer that uses the two-tier
// pick contract (stars, Sol planets, eventually clouds / LG wireframes).
// Tiny chart-mode discs (down to 1–2 px) leave a sub-pixel target that
// the cursor can easily miss even when visually right on top of the
// object. Floor the disc-test radius to a value the cursor can
// realistically land within. Hoisted here (away from stellata.ts) so the
// star and planet pick paths share a single source.
export const MIN_DISC_HIT_RADIUS_PX = 4;

// Pick score: pxDist + sub-pixel appMag bias. The bias only matters
// for near-coincident candidates (catalogue rows sharing x/y/z, e.g.
// Alula Australis A/B). Camera distance is deliberately NOT a
// tiebreaker: the Double Double (ε¹/ε² Lyr) has overlapping hitboxes
// at typical zoom, and "closest to camera" leaves one component
// permanently un-clickable.
export function pickScore(pxDist: number, appMag: number): number {
  return pxDist + appMag * PICK_MAG_BIAS_PX_PER_MAG;
}

// One projected pick candidate, after the prime/fallback filter has
// already accepted it. `hitRadius` is the prime-tier disc radius
// (`max(pxSize/2, MIN_DISC_HIT_RADIUS_PX)`) — caller-computed because
// it depends on rendered disc size. Pure-data shape so the reducer
// below stays unit-testable without a Three.js scene. Non-star
// providers (planets, Local Group, heliopause apex) extend this with
// no extra fields and pass the default `pxDist` scorer.
export type PickCandidate = {
  idx: number;
  pxDist: number;
  hitRadius: number;
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
};

// Winning candidate from `pickFromCandidates`, with the prime/fallback
// classification carried alongside. Returning the candidate (rather
// than just its idx) lets hover-tier callers (`pickStarHit`,
// `LocalGroupLayer.pick`, `PlanetBodyField.pick`) read the winning
// candidate's `pxDist`/`hitRadius`/extension fields without re-walking
// the projection. `tier` mirrors the reducer's two-tier split so the
// `HoverHit` tier field is keyed off the same comparison the reducer
// already made — no separate caller-side classification.
export type PickResult<T extends PickCandidate> = {
  candidate: T;
  tier: 'prime' | 'fallback';
};

// Reduce a candidate list to the winning candidate (or null) under the
// two-tier pick contract:
//   prime  — `pxDist <= hitRadius` (cursor inside the rendered disc /
//            wireframe envelope)
//   fallback — `pxDist <= pixelThreshold` (cursor near the centre, no
//              disc hit). Only consulted when no prime hit exists.
// Within each tier, lowest `scoreFn(c)` wins. Prime hits ALWAYS beat
// fallback hits — a prime candidate just inside its hit radius beats
// a fallback candidate one pixel from the cursor, regardless of score.
//
// `scoreFn` defaults to "closest to cursor wins" (`c.pxDist`) — the
// natural choice for layers without a brightness bias. The star caller
// passes `pickScore` to retain the sub-pixel mag tiebreaker.
//
// Single source of truth across all layered pickers in the hover layer:
// star (StarPickCandidate, pickScore), Local Group (PickCandidate +
// cameraDistancePc, default scorer), planets (cross-host candidate with
// hostStarIdx/planetIdx/cameraDistancePc, default scorer). Callers that
// only need the winning idx unwrap with `result?.candidate.idx ?? -1`.
export function pickFromCandidates<T extends PickCandidate>(
  candidates: Iterable<T>,
  pixelThreshold: number,
  scoreFn: (c: T) => number = (c) => c.pxDist,
): PickResult<T> | null {
  let prime: T | null = null;
  let primeBest = Infinity;
  let fb: T | null = null;
  let fbBest = Infinity;
  for (const c of candidates) {
    const score = scoreFn(c);
    if (c.pxDist <= c.hitRadius) {
      if (score < primeBest) {
        primeBest = score;
        prime = c;
      }
    } else if (c.pxDist <= pixelThreshold) {
      if (score < fbBest) {
        fbBest = score;
        fb = c;
      }
    }
  }
  if (prime !== null) return { candidate: prime, tier: 'prime' };
  if (fb !== null) return { candidate: fb, tier: 'fallback' };
  return null;
}

// Solve for camera distance `d` such that a star of radius `R_pc`
// (physical, in pc) fills `targetFrac` of `min(viewport.x, viewport.y)`
// at the current FOV. Symbolically:
//   targetFrac · fovMinor = 2·atan(R / d)
//   d = R / tan(targetFrac · fovMinor / 2)
// Used both for the manual-zoom orbit floor (targetFrac = 0.9) and the
// auto-park distance (targetFrac = 0.10).
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

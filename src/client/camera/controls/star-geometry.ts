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

// Floor on the prime-disc hit radius for any layer that uses the two-tier
// pick contract (stars, Sol planets, eventually clouds / LG wireframes).
// Tiny chart-mode discs (down to 1–2 px) leave a sub-pixel target that
// the cursor can easily miss even when visually right on top of the
// object. Floor the disc-test radius to a value the cursor can
// realistically land within. Hoisted here (away from stellata.ts) so the
// star and planet pick paths share a single source.
export const MIN_DISC_HIT_RADIUS_PX = 4;

// The grab radius, shared by hover and click because it is not only a
// reach: it floors every candidate's reported enclosure, which is the
// primary ranking key. Two values would rank the same candidates
// differently wherever a drawn half-extent falls between them, so the
// pick under the cursor would depend on whether you hovered or clicked.
export const PICK_THRESHOLD_PX = 7;

// Prime-tier hit radius for a drawn diameter. The floor applies to the
// resolved radius as much as the prefilter's, so a star dimmed to a
// sub-pixel disc stays as reachable as a chart-mode one.
export function discHitRadiusPx(drawnDiameterPx: number): number {
  return Math.max(drawnDiameterPx * 0.5, MIN_DISC_HIT_RADIUS_PX);
}

// Pick score: (pxDist + sub-pixel appMag bias) over the candidate's own
// hit radius — how deep inside its own target the cursor sits, so a
// candidate the cursor is halfway into beats one it is barely clipping
// however many pixels each is from its centre. The WHOLE numerator is
// normalised, which is what leaves the tuned behaviour among same-size
// candidates untouched: an equal divisor cancels out of the comparison.
// The bias itself only matters for near-coincident candidates (catalogue
// rows sharing x/y/z, e.g. Alula Australis A/B). Camera distance is
// deliberately NOT a tiebreaker: the Double Double (ε¹/ε² Lyr) has
// overlapping hitboxes at typical zoom, and "closest to camera" leaves
// one component permanently un-clickable.
export function pickScore(pxDist: number, appMag: number, hitRadius: number): number {
  return (pxDist + appMag * PICK_MAG_BIAS_PX_PER_MAG) / hitRadius;
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
  /** Set by layers whose enclosure test is a mesh raycast rather than a
   *  radius compare: the cursor is inside the drawn silhouette even
   *  though `pxDist` can exceed `hitRadius` on a near-side lobe, whose
   *  centre projects farther out than the extent sphere subtends. The
   *  radius then reports size only, which is what the cross-layer
   *  comparator needs it for. */
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

// The on-screen half-extent a cursor can be inside for this candidate:
// its drawn radius, floored at the grab threshold so a sub-pixel disc
// still reports the radius a user can aim at. This is the cross-layer
// ranking key every `HoverHit` carries (`../../hover/hover-types.ts`) —
// smallest wins — so it must be computed the same way for every kind,
// which is why it lives here rather than in each provider.
//
// Rounded to whole pixels, and that rounding is load-bearing rather than
// cosmetic: two objects the user sees as the same size can differ in the
// float by a thousandth of a pixel, and ranking on that would let an
// invisible difference decide the pick instead of where the cursor
// actually is. Equal to the pixel means peers, and peers fall to the
// depth tiebreak.
export function enclosureRadiusPx(hitRadius: number, pixelThreshold: number): number {
  return Math.round(Math.max(hitRadius, pixelThreshold));
}

// Winning candidate from `pickFromCandidates`. Returning the candidate
// (rather than just its idx) lets callers (`pickStarHit`,
// `LocalGroupLayer.pick`, `PlanetBodyField.pick`) read the winning
// candidate's `pxDist`/`hitRadius`/extension fields without re-walking
// the projection. `enclosureRadiusPx` and `depthScore` are the two
// numbers the cross-layer comparator ranks on, keyed off the comparison
// the reducer already made so no caller re-derives them.
export type PickResult<T extends PickCandidate> = {
  candidate: T;
  enclosureRadiusPx: number;
  depthScore: number;
};

// Reduce a candidate list to the winning candidate (or null) under one
// rule: among the surfaces enclosing the cursor, the TIGHTEST wins, and
// `scoreFn` separates two of equal size. A candidate encloses the cursor
// when `pxDist <= enclosureRadiusPx(...)`, or whenever it says so itself
// via `enclosed`.
//
// Size is the primary key rather than depth because depth alone makes a
// small object unreachable inside a large one: the cursor sits
// proportionally deeper in a big complex near its centre than in a small
// cloud near its rim, so the big one takes the pick everywhere. Ranking
// on size is self-limiting instead — a small object can only take the
// pick over the small area it actually covers.
//
// This is the same comparison the cross-layer disambiguator makes
// (`../../hover/hover-pick-disambiguator.ts`), and deliberately so:
// smallest-of-smallest is the same answer as one flat comparison, so a
// layer resolving its own overlaps first cannot disagree with the
// ordering across layers.
//
// `scoreFn` defaults to "deepest inside its own target wins"
// (`c.pxDist / c.hitRadius`) — scale-invariant, so a compact object and a
// large one are both reachable rather than the large one taking every
// pixel it covers. The star caller passes `pickScore` for the same shape
// plus the sub-pixel mag tiebreaker. Every caller's radius comes from
// `discHitRadiusPx`, so the divisor is floored well above zero; a layer
// whose enclosure test IS the raycast sets `enclosed` and passes its own
// scorer (`../../molecular-clouds/cloud-pick-pure.ts`).
//
// Single source of truth across all layered pickers in the hover layer:
// star (StarPickCandidate, pickScore), Local Group (PickCandidate +
// cameraDistancePc, default scorer), planets (cross-host candidate with
// hostStarIdx/planetIdx/cameraDistancePc, default scorer). Callers that
// only need the winning idx unwrap with `result?.candidate.idx ?? -1`.
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
 * Laziness is the point, not an optimisation: on the WebGL2 escape hatch
 * `resolve` reads per-star extinction back off the GPU, so evaluating
 * every candidate would cost one synchronous readback each. In rank order
 * the first visible candidate is almost always the first one tried.
 *
 * Callers must pass a `hitRadius` that is an upper bound of the resolved
 * one, so the walk can never skip a candidate that would have enclosed
 * the cursor. Resolution only ever shrinks a radius, and the enclosure
 * radius floors at `pixelThreshold`, so the pre-resolve key is an upper
 * bound of the true one and a candidate whose disc no longer reaches the
 * cursor simply stops qualifying rather than needing a second pool.
 *
 * The score therefore normalises against that upper bound, not against
 * the resolved radius: scoring on the resolved one would mean resolving
 * every candidate to sort them, which is the readback per candidate the
 * laziness exists to avoid.
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
  const keyOf = (c: T): [number, number] =>
    [enclosureRadiusPx(c.hitRadius, pixelThreshold), scoreFn(c)];
  eligible.sort((a, b) => {
    const [ra, sa] = keyOf(a);
    const [rb, sb] = keyOf(b);
    return ra === rb ? sa - sb : ra - rb;
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

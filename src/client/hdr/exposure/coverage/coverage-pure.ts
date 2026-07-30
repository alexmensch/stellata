// Occluder-coverage math: the depth inverse, deterministic disc taps, ring
// slant transmission, and the single-bracket depth range. Most of it is the
// executable spec coverage.frag.glsl is pinned against — README.md § Files.

import { FAR_MARGIN, NEAR_FRACTION, NEAR_MIN_PC, type MemberSphere }
  from '../../../local-depth/slice-pure';

/** Tap count per source. Equal-area stratified, so the sampling error on
 *  a fraction is ~1/(2√K) — 6% at 64, well under the circle
 *  approximation it replaces (10% on Saturn's flattening alone). */
export const COVERAGE_TAPS = 64;

/** Vogel's golden angle, π(3 − √5) — the spiral that makes the tap set
 *  equal-area at any K without a stored table or an RNG. */
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Relative floor on the self-occlusion slack, for a source whose own
 *  footprint is too small to supply one. A source drawn into the same
 *  scene stamps its own depth, so without a slack every source occludes
 *  itself; a real occluder sits orders of magnitude nearer (Saturn at
 *  1e-3 AU against Sol at 1 AU). */
export const SELF_OCCLUSION_SLACK = 1e-3;

/** Sources the coverage target carries texels for. Generous against the
 *  ~27 bodies plus single-digit stars the walk produces
 *  (`../README.md` § Adaptation); a frame past the cap leaves its excess
 *  sources unmeasured, which reads as unoccluded. */
export const COVERAGE_MAX_SOURCES = 128;

/** Ring systems the shader carries extinction slots for — Saturn,
 *  Uranus and Neptune are every one the app ships
 *  (`data/textures/README.md` § Ring strips). */
export const COVERAGE_MAX_RINGS = 3;

/** Occluder-depth target size as a fraction of the drawing buffer **per
 *  axis** — a quarter of the pixels. Depth *values* are
 *  resolution-independent, so this coarsens only which surface a tap
 *  lands on. */
export const COVERAGE_DEPTH_SCALE = 0.5;

/** Depth at or above this means nothing was drawn on that tap. Checked
 *  BEFORE the distance compare: a cleared texel reads as the bracket's
 *  far plane, which is nearer than any source beyond the bracket and
 *  would otherwise read as a full occlusion. */
export const CLEAR_DEPTH_EPS = 1e-6;

/**
 * Tap `i` of `k` over the unit disc, as (x, y) offsets in [-1, 1].
 * Deterministic — the GPU mirror computes the same point from
 * `gl_FragCoord`-derived indices, and `Math.random` would make the
 * statistic depend on frame order.
 */
export function coverageTap(i: number, k: number, out: [number, number]): [number, number] {
  const r = Math.sqrt((i + 0.5) / k);
  const theta = i * GOLDEN_ANGLE;
  out[0] = r * Math.cos(theta);
  out[1] = r * Math.sin(theta);
  return out;
}

/**
 * View-space distance a depth-buffer value came from, for a standard
 * perspective projection over `[nearPc, farPc]`. `depth01` is the raw
 * texel in [0, 1]; the exact inverse of `z → (z_ndc + 1) / 2`, so
 * `viewDistanceFromDepth(depthFromViewDistance(z)) === z`.
 */
export function viewDistanceFromDepth(depth01: number, nearPc: number, farPc: number): number {
  const zNdc = 2 * depth01 - 1;
  return (2 * farPc * nearPc) / ((farPc + nearPc) - zNdc * (farPc - nearPc));
}

/** Forward direction of `viewDistanceFromDepth` — the pinning mirror,
 *  and what a test needs to build a synthetic depth texel. */
export function depthFromViewDistance(zPc: number, nearPc: number, farPc: number): number {
  const zNdc = ((farPc + nearPc) * zPc - 2 * farPc * nearPc) / ((farPc - nearPc) * zPc);
  return 0.5 * (zNdc + 1);
}

/**
 * Length of the unnormalised view ray `(x·tanX, y·tanY, −1)` through the
 * NDC point `(ndcX, ndcY)`. It is the radial-distance-per-unit-axial-depth
 * factor for that pixel, and the only thing standing between the two
 * distance conventions below.
 */
export function viewRayLength(
  ndcX: number,
  ndcY: number,
  tanHalfFovX: number,
  tanHalfFovY: number,
): number {
  const x = ndcX * tanHalfFovX;
  const y = ndcY * tanHalfFovY;
  return Math.sqrt(x * x + y * y + 1);
}

/**
 * Radial camera distance → view-axis depth, for a point seen through a
 * pixel of ray length `rayLen`.
 *
 * The depth buffer stores the **axis** distance while every sample carries
 * a **radial** one, and off-axis the two differ by `1/cos` — 28% at the
 * corner of a 16:9 frame with a 50° vertical FOV, against a 0.1% slack.
 * Compare the two directly and every off-centre source occludes itself.
 */
export function axialFromRadial(distPc: number, rayLen: number): number {
  return distPc / rayLen;
}

/** View-axis depth → radial camera distance, the inverse of
 *  `axialFromRadial`. What the ring pass needs: it bounds its ray at the
 *  source, and a ray parameter is a radial distance. */
export function radialFromAxial(depthPc: number, rayLen: number): number {
  return depthPc * rayLen;
}

/**
 * Depth margin below a source before a surface counts as an occluder: the
 * source's own bounding radius, floored at `SELF_OCCLUSION_SLACK` of its
 * depth. Why it cannot be a fixed relative constant — README.md § The
 * slack is the source's own radius.
 */
export function selfOcclusionSlackPc(
  footprintRadiusPx: number,
  pxPerRadian: number,
  sourceDepthPc: number,
): number {
  const angularRadius = footprintRadiusPx / Math.max(pxPerRadian, 1e-9);
  return Math.max(angularRadius, SELF_OCCLUSION_SLACK) * sourceDepthPc;
}

/**
 * Is a tap occluded for a source at view-axis depth `sourceDepthPc`?
 * `depth01` is the tap's depth texel from a bracket of `[nearPc, farPc]`,
 * and `slackPc` comes from `selfOcclusionSlackPc`.
 *
 * Two guards, in this order: a cleared texel is never an occluder
 * (§ CLEAR_DEPTH_EPS), and a surface inside the source's own slack is the
 * source's own stamp.
 */
export function tapOccluded(
  depth01: number,
  sourceDepthPc: number,
  slackPc: number,
  nearPc: number,
  farPc: number,
): boolean {
  if (depth01 >= 1 - CLEAR_DEPTH_EPS) return false;
  return viewDistanceFromDepth(depth01, nearPc, farPc) < sourceDepthPc - slackPc;
}

/**
 * Fraction of a ring's light path that gets through: `(1 − alpha)^(1/|sin
 * B|)` for the strip's authored normal-depth alpha at opening angle `B`.
 * Derivation and why the angle has to be in it — README.md § Rings.
 */
export function ringTransmission(stripAlpha: number, sinOpeningAngle: number): number {
  const a = Math.min(Math.max(stripAlpha, 0), 1);
  if (a <= 0) return 1;
  if (a >= 1) return 0;
  const sinB = Math.max(Math.abs(sinOpeningAngle), RING_MIN_SIN_OPENING);
  return (1 - a) ** (1 / sinB);
}

/** Floor on `|sin B|`, so a ray lying in the ring plane divides by
 *  something. The annulus has zero thickness, so exactly edge-on is
 *  measure-zero geometry that draws as a line — the floor's job is
 *  arithmetic, not physics. */
export const RING_MIN_SIN_OPENING = 1e-6;

/**
 * Transmission of one ring annulus along a view ray, all in view space:
 * `(dx, dy, dz)` unit ray from the camera, annulus centred at
 * `(cx, cy, cz)` with unit pole `(nx, ny, nz)`, spanning
 * `innerRatio·outerPc` → `outerPc`.
 *
 * Returns 1 — no extinction — when the ray misses the annulus, runs
 * parallel to its plane, or crosses it at or beyond `sourceRadialPc`: a
 * ring behind the source cannot dim it. `stripAlphaAt` samples the radial
 * strip's authored alpha, the same inner→outer `U` the ring shader reads;
 * `alphaScale` is the annulus's live crossfade weight, so the extinction
 * tracks the alpha actually composited rather than the authored strip.
 */
export function ringRayTransmission(
  dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number,
  nx: number, ny: number, nz: number,
  outerPc: number,
  innerRatio: number,
  sourceRadialPc: number,
  stripAlphaAt: (u: number) => number,
  alphaScale: number,
): number {
  const sinB = dx * nx + dy * ny + dz * nz;
  if (Math.abs(sinB) < RING_MIN_SIN_OPENING) return 1;
  const t = (cx * nx + cy * ny + cz * nz) / sinB;
  if (t <= 0 || t >= sourceRadialPc) return 1;
  const hx = t * dx - cx;
  const hy = t * dy - cy;
  const hz = t * dz - cz;
  const r = Math.sqrt(hx * hx + hy * hy + hz * hz);
  if (r < innerRatio * outerPc || r > outerPc) return 1;
  return ringTransmission(
    stripAlphaAt((r / outerPc - innerRatio) / (1 - innerRatio)) * alphaScale,
    sinB,
  );
}

/**
 * Mean throughput over a source's visibility disc: the tap loop's
 * reduction. `tapThroughput` returns each tap's transmission, or `null`
 * for a tap outside the frame — those leave both sides of the mean,
 * because the frame-clipping term already owns them and the product would
 * otherwise count the same loss twice. No tap in frame reads as 1, and
 * clipping is then exactly 0 over the same disc, so the product is 0.
 */
export function meanTapThroughput(
  taps: number,
  tapThroughput: (i: number, offX: number, offY: number) => number | null,
): number {
  const off: [number, number] = [0, 0];
  let sum = 0;
  let n = 0;
  for (let i = 0; i < taps; i++) {
    coverageTap(i, taps, off);
    const t = tapThroughput(i, off[0], off[1]);
    if (t === null) continue;
    sum += t;
    n++;
  }
  return n === 0 ? 1 : sum / n;
}

/**
 * The single [near, far] bracket the occluder-depth pass renders in.
 * Deliberately NOT the local pass's slice partition: that pass clears
 * depth between slices, so only one slice's depth ever survives, and each
 * slice carries its own projection. One bracket answers the only question
 * asked here — "is a surface nearer than this source?" — and leaves the
 * local pass's attachment, and therefore its precision bound, untouched.
 */
export function coverageBracket(
  spheres: readonly MemberSphere[],
): { nearPc: number; farPc: number } | null {
  if (spheres.length === 0) return null;
  let minSurface = Infinity;
  let maxExtent = 0;
  for (const s of spheres) {
    minSurface = Math.min(minSurface, s.distPc - s.radiusPc);
    maxExtent = Math.max(maxExtent, s.distPc + s.radiusPc);
  }
  const nearPc = Math.max(NEAR_MIN_PC, NEAR_FRACTION * minSurface);
  return { nearPc, farPc: Math.max(FAR_MARGIN * maxExtent, nearPc * 2) };
}

/**
 * A source's visible fraction from the two independent losses.
 *
 * **Multiplicative, where the circle-era formula subtracted.** Subtracting
 * was forced by not knowing where an occluder sat relative to the frame
 * edge. Both terms now run over the one `visibilityDiscRadiusPx` disc —
 * `clipped` is what fraction of it is in frame, `transmission` the mean
 * throughput over exactly that part — which is what makes the product
 * exact rather than two fractions of different regions.
 */
export function visibleFraction(clipped: number, transmission: number): number {
  return Math.min(Math.max(clipped, 0), 1) * Math.min(Math.max(transmission, 0), 1);
}

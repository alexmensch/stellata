// Scene-driven exposure adaptation: mean visible flux per viewport pixel,
// the frame's brightest visible pixel, and the cut the two imply. See
// README.md § Adaptation.

import { smoothstep } from '../../galactic/galactic-fade';
import { luminanceForMagnitude } from '../emission-pure';
import { visibleFraction } from './coverage/coverage-pure';

/** Display luminance a correctly-exposed sunlit disc reads at —
 *  measured, not chosen: the geometric mean of three independently
 *  judged planets (`docs/science-hdr-pipeline.md` § 3.1). */
export const L_TARGET = 0.89;

/** Reference coverage — the frame fraction a body lands exactly on
 *  `L_TARGET` at. Not free: it is the park coverage, derived from
 *  `PLANET_PARK_FILL_FRACTION` on the calibration viewport's minor axis
 *  (§ 3.1 carries the derivation). */
export const ADAPT_REF_COVERAGE = 0.0685;

/** Adaptation anchor — `L̄` at which the perception branch's cut is
 *  exactly zero. */
export const L_ADAPT = L_TARGET * ADAPT_REF_COVERAGE;

/** Ceiling the highlight guard holds the frame's brightest **visible
 *  pixel** at — a display compensation, not a perceptual claim; § 3.2
 *  (The highlight guard) carries the reasoning and the ~0.4 mag
 *  peak-over-mean margin to account for before raising it. The one knob
 *  smoke-tuning moves. */
export const L_CAP = 1.2;

/** The whole diffuse field as one term, for **one frame** of sky rather
 *  than the whole sphere (§ 3.1 carries the rows). Inert by construction
 *  — it exists so `L̄` is never exactly zero. */
export const DIFFUSE_FIELD_L = 8.0e-4;

/** A source contributing less than this fraction of `L_ADAPT` is dropped
 *  — worth at most 0.03 mag of cut, and below the fraction any single
 *  faint star can reach. */
export const ADAPT_NEGLIGIBLE_FRACTION = 0.03;

/** Absolute magnitude the star window is derived against — fainter
 *  stars are covered exactly, brighter ones leave through the window
 *  taper (README.md § Adaptation). */
export const ADAPT_STAR_ABSMAG_REF = -6;

/** Fraction of the star window the edge taper spans. Any source the
 *  window drops leaves continuously, so crossing the bound can never
 *  pop the exposure. */
export const ADAPT_WINDOW_TAPER_FRACTION = 0.2;

/** Width of the frustum-edge ramp, in px of centre travel — the floor
 *  on the clipping disc that keeps a sub-pixel source from flickering
 *  the exposure on the frame edge. README.md § Adaptation owns the
 *  hysteresis rejection. */
export const ADAPT_EDGE_RAMP_PX = 12;

/** Time constant of the slew limit on the **applied** cut, in real
 *  seconds. The measurement stays instantaneous, and the filter runs in
 *  magnitudes so the ramp is stops-per-second at any absolute level. */
export const ADAPT_SLEW_TAU_S = 0.3;

/** The slew snaps to its target inside this many magnitudes — an
 *  exponential never arrives, and exactly 0 is the sentinel the
 *  adapted-to label and the uniform's skip-if-unchanged both read. */
export const ADAPT_SLEW_SETTLE_MAG = 1e-3;

/** One frame of the slew limit: blend the applied cut toward the frame's
 *  measurement, snapping once inside `ADAPT_SLEW_SETTLE_MAG`. */
export function slewDm(applied: number, measured: number, blend: number): number {
  if (Math.abs(measured - applied) <= ADAPT_SLEW_SETTLE_MAG) return measured;
  return applied + (measured - applied) * blend;
}

/**
 * One light source's frame footprint. `diameterPx` is TRUE angular
 * extent in CSS pixels — never the K-exaggerated kernel, or the
 * footprint hack would drive adaptation. `fluxScale` carries real
 * losses (eclipse dim, window taper), never a display weight.
 * `cameraDistancePc` places the source along its own view ray for the
 * coverage measurement.
 *
 * `sourceKey` identifies the source across frames, because the coverage
 * measurement lands one frame after the walk that requested it. Producers
 * own disjoint ranges: bodies use their flat instance index, stars
 * `-1 - starIdx`.
 */
export interface LuminanceSample {
  appMag: number;
  diameterPx: number;
  screenX: number;
  screenY: number;
  cameraDistancePc: number;
  fluxScale: number;
  sourceKey: number;
  label: string | null;
}

/** A star's `sourceKey`, in the negative half so it can never collide
 *  with a body's flat instance index. */
export function starSourceKey(starIdx: number): number {
  return -1 - starIdx;
}

/** Radius of the footprint a source's flux is actually spread over,
 *  floored at the 1 px² an unresolved point occupies — the same
 *  `max(1, π·r²)` denominator `stellataPointSourcePeak` uses. Occlusion
 *  and the peak both run against this TRUE footprint, never against the
 *  widened edge-ramp disc. */
export function footprintRadiusPx(diameterPx: number): number {
  return Math.max(0.5 * diameterPx, POINT_SOURCE_RADIUS_PX);
}

const POINT_SOURCE_RADIUS_PX = Math.sqrt(1 / Math.PI);

/** Area of a disc of radius `r` centred at the origin intersected with
 *  the axis-aligned quadrant `[0,x] × [0,y]`, for `x, y ≥ 0`. */
function discQuadrantArea(r: number, x: number, y: number): number {
  const a = Math.min(x, r);
  const b = Math.min(y, r);
  if (a <= 0 || b <= 0) return 0;
  const rr = r * r;
  if (a * a + b * b <= rr) return a * b;
  const cut = Math.sqrt(Math.max(0, rr - b * b));
  const arc = (t: number) =>
    0.5 * (t * Math.sqrt(Math.max(0, rr - t * t)) + rr * Math.asin(Math.min(1, t / r)));
  return b * cut + arc(a) - arc(cut);
}

function discQuadrantAreaSigned(r: number, x: number, y: number): number {
  return Math.sign(x) * Math.sign(y) * discQuadrantArea(r, Math.abs(x), Math.abs(y));
}

/**
 * Area of a disc of radius `r` centred at `(cx, cy)` inside the viewport
 * rectangle `[0,w] × [0,h]`, in px². Exact: interval additivity in each
 * axis reduces the rectangle to four signed quadrant terms.
 */
export function discViewportOverlapArea(
  r: number,
  cx: number,
  cy: number,
  w: number,
  h: number,
): number {
  const x1 = -cx;
  const x2 = w - cx;
  const y1 = -cy;
  const y2 = h - cy;
  return (
    discQuadrantAreaSigned(r, x2, y2)
    - discQuadrantAreaSigned(r, x1, y2)
    - discQuadrantAreaSigned(r, x2, y1)
    + discQuadrantAreaSigned(r, x1, y1)
  );
}

/**
 * Fraction of a source's own footprint inside the viewport — the only
 * place coverage enters the statistic (surface brightness × area is
 * flux). The disc is floored at `ADAPT_EDGE_RAMP_PX` across; fully
 * inside and fully outside are unchanged, so the floor only sets how
 * wide the crossing band is.
 */
export function sourceVisibleFraction(
  diameterPx: number,
  cx: number,
  cy: number,
  w: number,
  h: number,
): number {
  const r = Math.max(footprintRadiusPx(diameterPx), 0.5 * ADAPT_EDGE_RAMP_PX);
  return discViewportOverlapArea(r, cx, cy, w, h) / (Math.PI * r * r);
}

/** What fraction of a source's light reaches the camera: frame clipping,
 *  times the GPU-measured mean throughput over the part of the footprint
 *  that is in frame (`coverage/README.md` § Composition). */
export function sampleVisibleFraction(
  subject: LuminanceSample,
  transmission: number,
  w: number,
  h: number,
): number {
  return visibleFraction(
    sourceVisibleFraction(subject.diameterPx, subject.screenX, subject.screenY, w, h),
    transmission,
  );
}

/** A sample's contribution to the frame's total flux, in luminance × px.
 *  `exposure` is the BASE instrument exposure — feeding the live
 *  adapted/trimmed scalar back in would close a loop. */
export function sampleFluxL(
  s: LuminanceSample,
  exposure: number,
  visibleFraction: number,
): number {
  return luminanceForMagnitude(exposure, s.appMag) * s.fluxScale * visibleFraction;
}

/** Area-weighted mean luminance over the viewport: total visible flux
 *  spread over every pixel, plus the diffuse field. */
export function meanSceneLuminance(fluxL: number, w: number, h: number): number {
  return fluxL / Math.max(1, w * h) + DIFFUSE_FIELD_L;
}

/** Per-pixel luminance of a sample's brightest pixel — flux over
 *  footprint, `stellataPointSourcePeak`'s rule. Deliberately unclamped:
 *  `LUMA_CEIL` would understate a very bright source's peak. */
export function samplePeakL(s: LuminanceSample, exposure: number): number {
  const r = footprintRadiusPx(s.diameterPx);
  return (luminanceForMagnitude(exposure, s.appMag) * s.fluxScale) / (Math.PI * r * r);
}

/**
 * The perception branch: retinal illuminance drives the cut. `dm ≤ 0` is
 * an invariant — a dark-adapted eye at the instrument's limit is the
 * ceiling, so adaptation only ever cuts.
 */
export function eyeAdaptationDm(meanL: number): number {
  if (meanL <= L_ADAPT) return 0;
  return -2.5 * Math.log10(meanL / L_ADAPT);
}

/**
 * The display branch: hold the frame's brightest visible pixel at
 * `L_CAP`. Also clamped at 0 — it is a *limit* on saturation, never a
 * licence to expose past threshold.
 */
export function highlightGuardDm(peakL: number): number {
  if (peakL <= L_CAP) return 0;
  return -2.5 * Math.log10(peakL / L_CAP);
}

/**
 * The frame's cut: a `max` of two ≤ 0 branches, so the guard can only
 * ever raise the exposure, and the branches are equal at coverage
 * `L_ADAPT / L_CAP` — a continuous, stateless handover (README.md
 * § Adaptation).
 */
export function adaptationDm(meanL: number, peakL: number): number {
  return Math.max(eyeAdaptationDm(meanL), highlightGuardDm(peakL));
}

/** Coverage at which the two branches agree — above it the guard governs
 *  and a resolved surface reads `L_CAP`, below it the perception model
 *  does and a small bright source is allowed to clip. */
export function guardHandoverCoverage(): number {
  return L_ADAPT / L_CAP;
}

/** Disc-mean luminance a body of coverage `f` settles at: `L_ADAPT / f`
 *  under the perception branch, flat at `L_CAP` where the guard governs
 *  (§ 3.2's sensitivity analysis). */
export function adaptedDiscMeanL(coverage: number): number {
  return Math.max(L_ADAPT / coverage, L_CAP);
}

/** Stops of manual trim a body of coverage `f` needs to land its disc
 *  mean back on `L_TARGET`. Zero at the reference coverage; constant
 *  wherever the guard governs, since the guard already pins the level. */
export function trimStopsForCoverage(coverage: number): number {
  return Math.log2(L_TARGET / adaptedDiscMeanL(coverage));
}

/** Apparent magnitude at which a point source stops mattering — the
 *  flux gate every candidate passes before any projection work. */
export function negligibleAppMag(exposure: number, viewportAreaPx: number): number {
  const fluxL = ADAPT_NEGLIGIBLE_FRACTION * L_ADAPT * viewportAreaPx;
  return -2.5 * Math.log10(fluxL / exposure);
}

/**
 * Camera-distance bound for the star walk: where a star of
 * `ADAPT_STAR_ABSMAG_REF` crosses the negligible magnitude. Every
 * fainter star is covered exactly — it cannot reach the gate from
 * further out — and every brighter one leaves through the taper.
 */
export function starAdaptationWindowPc(exposure: number, viewportAreaPx: number): number {
  const mag = negligibleAppMag(exposure, viewportAreaPx);
  return 10 * 10 ** ((mag - ADAPT_STAR_ABSMAG_REF) / 5);
}

/** Window edge taper — 1 well inside, 0 at the bound. */
export function windowTaper(dPc: number, windowPc: number): number {
  return 1 - smoothstep((1 - ADAPT_WINDOW_TAPER_FRACTION) * windowPc, windowPc, dPc);
}

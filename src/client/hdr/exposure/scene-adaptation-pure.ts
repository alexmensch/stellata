// Scene-driven exposure adaptation: mean visible flux per viewport
// pixel, and the exposure cut it implies. See README.md § Adaptation.

import { circleCircleLensArea } from '../../binaries/eclipse/eclipse-photometry-pure';
import { smoothstep } from '../../galactic/galactic-fade';
import { MESH_FADE_MIN_PX } from '../../solar-system/planets/mesh-crossfade';
import { luminanceForMagnitude } from '../emission-pure';

/**
 * Display luminance a correctly-exposed sunlit disc reads at — measured,
 * not chosen. Three independently-judged planets (Neptune 0.919, Uranus
 * 0.824, Jupiter 0.940) agree to 0.14 mag across a 40× range in
 * intrinsic surface brightness; this is their geometric mean.
 * `docs/science-hdr-pipeline.md` § 3.1 carries the smoke pass.
 */
export const L_TARGET = 0.89;

/**
 * Reference coverage: the frame fraction a body lands exactly on
 * `L_TARGET` at, and the one free parameter of the perception branch. It
 * is the **park coverage** — a focused body is parked filling 0.3 of the
 * viewport's minor axis, so its disc covers `π·0.15²·min(w,h)²/(w·h)`,
 * which is 6.85% on the calibration viewport. Landing the measured
 * `L_TARGET` on the framing the user actually sees a body in is what
 * makes the trim a correction rather than a permanent offset.
 */
export const ADAPT_REF_COVERAGE = 0.0685;

/** Adaptation anchor — `L̄` at which the perception branch's cut is
 *  exactly zero. */
export const L_ADAPT = L_TARGET * ADAPT_REF_COVERAGE;

/**
 * Ceiling the highlight guard holds the frame's brightest **visible
 * pixel** at. This is a display compensation and not a perceptual claim
 * (`docs/science-hdr-pipeline.md` § 3.2 — The highlight guard): a
 * resolved surface really would be far brighter, and a monitor cannot
 * show that, so the guard shows what can be perceived instead of clipping
 * it to flat white. It sits well under the operator's own clipping onset
 * (~8–20), which is the headroom that keeps a disc's real peak — up to
 * ~0.4 mag over the mean this statistic measures — off the white point.
 * The one knob smoke-tuning moves.
 */
export const L_CAP = 1.2;

/**
 * The whole diffuse field as one term, for **one frame** rather than the
 * whole sky: the frame's share of the threshold-star population (1.0e-4
 * — a 50°-FOV frame is 10.8% of the sky) plus the Milky Way band at its
 * anticentre-plane 22.55 mag/arcsec² (7.0e-4), both at the base
 * instrument exposure. Milky-Way-dominated, and inert by construction —
 * it exists so `L̄` is never exactly zero and the debug readout has a
 * floor to show. `docs/science-hdr-pipeline.md` § 3.1 carries the rows.
 */
export const DIFFUSE_FIELD_L = 8.0e-4;

/** A source contributing less than this fraction of `L_ADAPT` is dropped
 *  — worth at most 0.03 mag of cut, and below the fraction any single
 *  faint star can reach. */
export const ADAPT_NEGLIGIBLE_FRACTION = 0.03;

/**
 * Absolute magnitude the star window is derived against. Only 120 of the
 * catalogue's 313k stars are brighter, and the 22 brighter than −8 all
 * sit at extragalactic distances — so a star this window drops is
 * always one the taper has already faded to nothing.
 */
export const ADAPT_STAR_ABSMAG_REF = -6;

/** Fraction of the star window the edge taper spans. Any source the
 *  window drops leaves continuously, so crossing the bound can never
 *  pop the exposure. */
export const ADAPT_WINDOW_TAPER_FRACTION = 0.2;

/**
 * Width of the frustum-edge ramp, in px of centre travel. A source's
 * clipping fraction is evaluated against a disc at least this wide, so a
 * sub-pixel point crossing the frame edge fades over ~12 px instead of
 * stepping 0 → 1 within its own 1.1 px footprint. That step is what a
 * point jittering on the edge reads as flicker; widening the ramp is the
 * whole fix, and it needs no per-source state (which is what makes it
 * preferable to hysteresis — see `README.md` § Adaptation).
 */
export const ADAPT_EDGE_RAMP_PX = 12;

/**
 * True diameter below which a source stops acting as an occluder. It is
 * the mesh-presence floor: a body this small draws no surface at all, so
 * there is nothing for a source behind it to hide behind.
 */
export const ADAPT_OCCLUDER_MIN_PX = MESH_FADE_MIN_PX;

/**
 * One light source's frame footprint. `diameterPx` is TRUE angular
 * extent in CSS pixels — never the K-exaggerated kernel, or the
 * footprint hack would drive adaptation. `fluxScale` carries real
 * losses (eclipse dim, window taper), never a display weight.
 * `cameraDistancePc` orders the occlusion pass and nothing else.
 */
export interface LuminanceSample {
  appMag: number;
  diameterPx: number;
  screenX: number;
  screenY: number;
  cameraDistancePc: number;
  fluxScale: number;
  label: string | null;
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
 * Fraction of a source's own footprint that lands inside the viewport —
 * the only place coverage enters the statistic. Surface brightness ×
 * area is flux, so a fully on-screen source contributes its flux
 * whatever its size; clipping at the frame edge is what this measures,
 * and it ramps continuously as a source slides in.
 *
 * The disc the clipping runs against is floored at `ADAPT_EDGE_RAMP_PX`
 * across, which is what makes the ramp legible for a source smaller than
 * that: the fraction is 1 well inside the frame and 0 well outside it
 * either way, so the floor only sets how wide the crossing band is.
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

/**
 * Fraction of `subject`'s footprint hidden behind the nearer drawn discs
 * in `samples` — the camera-path light loss the eclipse dim does not
 * carry (that one is a lighting loss, and the two compose
 * multiplicatively). Screen-space circle-circle lens area per occluder,
 * summed, so two occluders overlapping each other double-count: the
 * error is always in the over-occluding direction and cannot invent
 * light. Occluders below `ADAPT_OCCLUDER_MIN_PX` are skipped, and rings
 * never occlude — they are not sources, so they never enter `samples`.
 */
export function occludedFraction(
  subject: LuminanceSample,
  samples: readonly LuminanceSample[],
  count: number,
): number {
  const r = footprintRadiusPx(subject.diameterPx);
  const area = Math.PI * r * r;
  let hidden = 0;
  for (let i = 0; i < count; i++) {
    const o = samples[i];
    if (o === subject) continue;
    if (o.cameraDistancePc >= subject.cameraDistancePc) continue;
    if (o.diameterPx < ADAPT_OCCLUDER_MIN_PX) continue;
    const dx = o.screenX - subject.screenX;
    const dy = o.screenY - subject.screenY;
    hidden += circleCircleLensArea(r, 0.5 * o.diameterPx, Math.hypot(dx, dy));
    if (hidden >= area) return 1;
  }
  return hidden / area;
}

/** What fraction of a source's light reaches the camera: frame clipping
 *  and occlusion by nearer discs, which are independent losses off the
 *  same footprint and so subtract. */
export function sampleVisibleFraction(
  subject: LuminanceSample,
  samples: readonly LuminanceSample[],
  count: number,
  w: number,
  h: number,
): number {
  const clipped = sourceVisibleFraction(
    subject.diameterPx, subject.screenX, subject.screenY, w, h,
  );
  if (clipped <= 0) return 0;
  return Math.max(0, clipped - occludedFraction(subject, samples, count));
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

/**
 * Per-pixel luminance of a sample's brightest pixel — its flux over the
 * footprint it is spread across, which is exactly
 * `stellataPointSourcePeak`'s rule. Unclamped, deliberately: `LUMA_CEIL`
 * would understate a very bright source's peak, and the guard reads the
 * peak to decide whether it can protect it at all.
 */
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
 * The frame's cut: whichever branch asks for less of one. Since both are
 * clamped at 0 the result is too, and since it is a maximum **the guard
 * can only ever raise the exposure** — which is what stops it from being
 * the maximum statistic § 3.1 rejects.
 *
 * The two branches are equal at the coverage `L_ADAPT / L_CAP`, so the
 * handover is a pure coverage threshold, independent of how bright the
 * source is, and continuous across it: no fade band, no state, and an
 * occluded source hands back smoothly as its visible coverage falls
 * through it.
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

/** Disc-mean luminance a body of frame coverage `f` reads at once
 *  adaptation has settled: `L_ADAPT / f` under the perception branch —
 *  `L_TARGET` exactly at `ADAPT_REF_COVERAGE`, drifting by the coverage
 *  ratio away from it (§ 3.2's sensitivity) — and flat at `L_CAP`
 *  wherever the guard governs, which is what makes brightness invariant
 *  in zoom above the handover coverage. The guard raises exposure, so the
 *  brighter of the two is the one that happens. */
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

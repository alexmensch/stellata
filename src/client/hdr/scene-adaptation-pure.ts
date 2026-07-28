// Scene-driven exposure adaptation: mean visible flux per viewport
// pixel, and the exposure cut it implies. See README.md § Adaptation.

import { smoothstep } from '../galactic/galactic-fade';
import { luminanceForMagnitude } from './emission-pure';

/**
 * Display luminance a correctly-exposed sunlit disc reads at — measured,
 * not chosen. Three independently-judged planets (Neptune 0.919, Uranus
 * 0.824, Jupiter 0.940) agree to 0.14 mag across a 40× range in
 * intrinsic surface brightness; this is their geometric mean.
 * `docs/science-hdr-pipeline.md` § 3.1 carries the smoke pass.
 */
export const L_TARGET = 0.89;

/** Reference coverage: the frame fraction a body lands exactly on
 *  `L_TARGET` at. The one free parameter of the model. */
export const ADAPT_REF_COVERAGE = 0.15;

/** Adaptation anchor — `L̄` at which the cut is exactly zero. */
export const L_ADAPT = L_TARGET * ADAPT_REF_COVERAGE;

/**
 * The whole diffuse field as one term: ~100 000 threshold-magnitude
 * stars at 1 px each (9.6e-4) plus the Milky Way band at 22 mag/arcsec²
 * over a full 50°-FOV frame (1.2e-3), both at the base instrument
 * exposure. Two decades below `L_ADAPT`, so it can never produce a cut
 * on its own — it exists so `L̄` is never exactly zero and the debug
 * readout has a floor to show.
 */
export const DIFFUSE_FIELD_L = 2.1e-3;

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

/** Radius of a source occupying the 1 px² floor — the area an unresolved
 *  point spreads its flux over (`pointSourcePeakLuminance`'s
 *  `max(1, π·r²)`). */
export const POINT_SOURCE_RADIUS_PX = Math.sqrt(1 / Math.PI);

/**
 * One light source's frame footprint. `diameterPx` is TRUE angular
 * extent in CSS pixels — never the K-exaggerated kernel, or the
 * footprint hack would drive adaptation. `fluxScale` carries real
 * losses (eclipse dim, window taper), never a display weight.
 */
export interface LuminanceSample {
  appMag: number;
  diameterPx: number;
  screenX: number;
  screenY: number;
  fluxScale: number;
  label: string | null;
}

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
 * An unresolved source is floored at the 1 px² area its flux is spread
 * over, which makes the same formula carry both regimes.
 */
export function sourceVisibleFraction(
  diameterPx: number,
  cx: number,
  cy: number,
  w: number,
  h: number,
): number {
  const r = Math.max(0.5 * diameterPx, POINT_SOURCE_RADIUS_PX);
  return discViewportOverlapArea(r, cx, cy, w, h) / (Math.PI * r * r);
}

/** A sample's contribution to the frame's total flux, in luminance × px.
 *  `exposure` is the BASE instrument exposure — feeding the live
 *  adapted/trimmed scalar back in would close a loop. */
export function sampleFluxL(
  s: LuminanceSample,
  exposure: number,
  w: number,
  h: number,
): number {
  return (
    luminanceForMagnitude(exposure, s.appMag)
    * s.fluxScale
    * sourceVisibleFraction(s.diameterPx, s.screenX, s.screenY, w, h)
  );
}

/** Area-weighted mean luminance over the viewport: total visible flux
 *  spread over every pixel, plus the diffuse field. */
export function meanSceneLuminance(fluxL: number, w: number, h: number): number {
  return fluxL / Math.max(1, w * h) + DIFFUSE_FIELD_L;
}

/**
 * The automatic exposure cut, in magnitudes. `dm ≤ 0` is an invariant: a
 * dark-adapted eye at the instrument's limit is the ceiling, so
 * adaptation only ever cuts.
 */
export function adaptationDm(meanL: number): number {
  if (meanL <= L_ADAPT) return 0;
  return -2.5 * Math.log10(meanL / L_ADAPT);
}

/** Disc-mean luminance a body of frame coverage `f` reads at once
 *  adaptation has settled — `L_TARGET` exactly at `ADAPT_REF_COVERAGE`,
 *  drifting by the coverage ratio away from it (§ 3.2's sensitivity). */
export function adaptedDiscMeanL(coverage: number): number {
  return L_ADAPT / coverage;
}

/** Stops of manual trim a body of coverage `f` needs to land its disc
 *  mean back on `L_TARGET`. Zero at the reference coverage. */
export function trimStopsForCoverage(coverage: number): number {
  return Math.log2(coverage / ADAPT_REF_COVERAGE);
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

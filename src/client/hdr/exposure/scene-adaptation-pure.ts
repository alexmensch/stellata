// Scene-driven exposure adaptation: the two branches the reduced frame
// statistic drives, and the cut they imply. See README.md § Adaptation.

import { EV_MAX_STOPS } from './exposure-epoch';
import { tonemapWhitePoint } from '../tonemap-pure';

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

/** Coverage at or above which the resolved-surface pin governs alone.
 *  The park framing, where the pin and the perception branch agree
 *  exactly for a body-dominated frame — so the top of the ramp is
 *  continuous by construction rather than by a fade. */
export const ADAPT_PIN_COVERAGE = ADAPT_REF_COVERAGE;

/** Coverage at or below which the perception branch governs alone: the
 *  smallest framing the EV trim can still pull back to `L_TARGET`
 *  (§ 3.2). Under it a body is past the trim's reach and reads as the
 *  brilliant dot § 3.2 says it should. */
export const ADAPT_DOT_COVERAGE = ADAPT_REF_COVERAGE / 2 ** EV_MAX_STOPS;

/** Time constant of the slew limit on the **applied** cut, in real
 *  seconds. The measurement stays instantaneous, and the filter runs in
 *  magnitudes so the ramp is stops-per-second at any absolute level. */
export const ADAPT_SLEW_TAU_S = 0.3;

/** The slew snaps to its target inside this many magnitudes — an
 *  exponential never arrives, and exactly 0 is the sentinel the
 *  uniform's skip-if-unchanged reads. */
export const ADAPT_SLEW_SETTLE_MAG = 1e-3;

/** One frame of the slew limit: blend the applied cut toward the frame's
 *  measurement, snapping once inside `ADAPT_SLEW_SETTLE_MAG`. */
export function slewDm(applied: number, measured: number, blend: number): number {
  if (Math.abs(measured - applied) <= ADAPT_SLEW_SETTLE_MAG) return measured;
  return applied + (measured - applied) * blend;
}

/** The three numbers one frame's reduction returns, all at the base
 *  instrument exposure (`reduction/README.md`). `surfaceL` and
 *  `coverage` are both frame means, so their ratio is the lit surface's
 *  own mean brightness — free of both its texture and its coverage. */
export interface FrameStatistic {
  /** Area-weighted mean of the flux channel over the whole frame. */
  meanL: number;
  /** Area-weighted mean of `L · lit-surface mask` over the whole frame. */
  surfaceL: number;
  /** Frame fraction covered by a lit resolved surface. */
  coverage: number;
}

export const EMPTY_FRAME_STATISTIC: FrameStatistic = {
  meanL: 0,
  surfaceL: 0,
  coverage: 0,
};

/** The two levels the branches are measured against. Ships at the
 *  constants above; the debug panel overrides `lAdapt` / `lTarget` live,
 *  and `whitePoint` tracks the operator's own `DR_MAG` knob — the floor is
 *  derived from it, so a swept white point that did not reach here would
 *  leave the floor describing a display range the operator no longer has. */
export interface AdaptationTuning {
  lAdapt: number;
  lTarget: number;
  whitePoint: number;
}

export const DEFAULT_ADAPTATION_TUNING: AdaptationTuning = {
  lAdapt: L_ADAPT,
  lTarget: L_TARGET,
  whitePoint: tonemapWhitePoint(),
};

/**
 * The perception branch: retinal illuminance drives the cut. `dm ≤ 0` is
 * an invariant — a dark-adapted eye at the instrument's limit is the
 * ceiling, so adaptation only ever cuts.
 */
export function eyeAdaptationDm(meanL: number, lAdapt = L_ADAPT): number {
  if (meanL <= lAdapt) return 0;
  return -2.5 * Math.log10(meanL / lAdapt);
}

/** The lit surface's own mean brightness: the masked mean over the masked
 *  area. Zero where nothing lit and resolved is in frame. */
export function surfaceMeanL(stat: FrameStatistic): number {
  return stat.coverage > 0 ? stat.surfaceL / stat.coverage : 0;
}

/**
 * The resolved-surface branch: hold the dominant lit surface's own mean
 * brightness at `L_TARGET`. Independent of that surface's texture and of
 * how much of the frame it fills, which is what makes approach neither
 * dim nor brighten it. Clamped at 0 like the perception branch.
 */
export function surfacePinDm(stat: FrameStatistic, lTarget = L_TARGET): number {
  const d = surfaceMeanL(stat);
  if (d <= lTarget) return 0;
  return -2.5 * Math.log10(d / lTarget);
}

/** The deepest cut any displayed frame can justify: the perception
 *  branch's own response to a full-white frame, the strongest stimulus
 *  the display can deliver. The scene-referred cut past this point
 *  simulates a retinal bleaching the monitor never caused —
 *  `docs/science-hdr-pipeline.md` § 3.2 (The display floor). */
export function displayFloorDm(tuning = DEFAULT_ADAPTATION_TUNING): number {
  return -2.5 * Math.log10(tuning.whitePoint / tuning.lAdapt);
}

export const ADAPT_DISPLAY_FLOOR_DM = displayFloorDm();

/** How much of the frame the resolved-surface pin governs, ramped over
 *  log coverage between the two derived bounds and smoothstepped so the
 *  crossing is C1 at both ends. A body drifting through the band cannot
 *  step the frame, and neither bound is a free constant. */
export function surfacePinWeight(coverage: number): number {
  if (coverage <= ADAPT_DOT_COVERAGE) return 0;
  if (coverage >= ADAPT_PIN_COVERAGE) return 1;
  const t =
    Math.log(coverage / ADAPT_DOT_COVERAGE) /
    Math.log(ADAPT_PIN_COVERAGE / ADAPT_DOT_COVERAGE);
  return t * t * (3 - 2 * t);
}

/** Which term set the applied cut — the diagnostic three quite different
 *  bugs share a symptom over. Read off the answer: `open` is the frame
 *  where no term asked for a cut at all, which is not the same as the
 *  perception branch measuring one and landing on zero. */
export type AdaptationRegime = 'open' | 'eye' | 'floor' | 'surface' | 'handover';

/** Every term behind one frame's cut, so a readout never has to recompute
 *  a branch and risk disagreeing with the frame it describes. */
export interface AdaptationBranches {
  eye: number;
  pin: number;
  floor: number;
  /** The lit surface's own mean brightness — the pin's input. */
  discL: number;
  coverage: number;
  weight: number;
  dm: number;
  regime: AdaptationRegime;
}

/**
 * The frame's cut, decomposed. A dominant lit surface takes the pin with
 * the display floor lifted; a frame without one runs the perception
 * branch bounded by that floor; the coverage ramp joins them
 * continuously. Nothing here caches which branch governed last frame,
 * and nothing may start to.
 */
export function adaptationBranches(
  stat: FrameStatistic,
  tuning = DEFAULT_ADAPTATION_TUNING,
): AdaptationBranches {
  const eye = eyeAdaptationDm(stat.meanL, tuning.lAdapt);
  const pin = surfacePinDm(stat, tuning.lTarget);
  const floor = displayFloorDm(tuning);
  const weight = surfacePinWeight(stat.coverage);
  const perception = Math.max(eye, floor);
  const dm = perception + (pin - perception) * weight;
  return {
    eye,
    pin,
    floor,
    discL: surfaceMeanL(stat),
    coverage: stat.coverage,
    weight,
    dm,
    regime: adaptationRegime(dm, eye, weight),
  };
}

function adaptationRegime(dm: number, eye: number, weight: number): AdaptationRegime {
  if (dm === 0) return 'open';
  if (weight >= 1) return 'surface';
  if (weight > 0) return 'handover';
  return dm === eye ? 'eye' : 'floor';
}

export function adaptationDm(
  stat: FrameStatistic,
  tuning = DEFAULT_ADAPTATION_TUNING,
): number {
  return adaptationBranches(stat, tuning).dm;
}

/** One masked emitter's share of a frame: the mean luminance over the texels
 *  it claims, and the fraction of the frame those texels are. */
export interface SurfacePatch {
  coverage: number;
  discMeanL: number;
}

/** The frame a set of lit resolved surfaces presents, with nothing unmasked
 *  in it. `D` comes out area-weighted across them — a globe and its ring
 *  annulus are one subject, exposed together rather than for whichever is
 *  brighter. */
export function surfacesStatistic(patches: readonly SurfacePatch[]): FrameStatistic {
  let surfaceL = 0;
  let coverage = 0;
  for (const patch of patches) {
    surfaceL += patch.discMeanL * patch.coverage;
    coverage += patch.coverage;
  }
  return { meanL: surfaceL, surfaceL, coverage };
}

/** The frame a lone body of `discMeanL` at `coverage` presents: every lit
 *  texel is that body, so the masked mean is the frame mean. */
export function loneBodyStatistic(coverage: number, discMeanL: number): FrameStatistic {
  return surfacesStatistic([{ coverage, discMeanL }]);
}

/** Disc-mean luminance a body settles at — `L_TARGET` wherever the pin
 *  governs, `L_ADAPT / f` under the perception branch, and clipped
 *  wherever the display floor binds, which is why the disc's own
 *  luminance is an input (§ 3.2's sensitivity analysis). */
export function adaptedDiscMeanL(
  coverage: number,
  discMeanL: number,
  tuning = DEFAULT_ADAPTATION_TUNING,
): number {
  const dm = adaptationDm(loneBodyStatistic(coverage, discMeanL), tuning);
  return discMeanL * 10 ** (0.4 * dm);
}

/** Stops of manual trim a body needs to land its disc mean back on
 *  `L_TARGET`. Zero wherever the pin governs, since the pin already puts
 *  it there. */
export function trimStopsForCoverage(
  coverage: number,
  discMeanL: number,
  tuning = DEFAULT_ADAPTATION_TUNING,
): number {
  return Math.log2(tuning.lTarget / adaptedDiscMeanL(coverage, discMeanL, tuning));
}

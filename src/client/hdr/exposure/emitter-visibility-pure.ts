// Whether an emitter puts a non-zero pixel on screen: its display
// kernel's peak carried through the soft taper, the faint-end toe and
// the operator. See README.md § What "visible" means to a pick path.

import {
  pointSourcePeakLuminance,
  surfaceBrightnessLuminance,
} from '../emission/emission-pure';
import { displayLevel } from '../tonemap/tonemap-pure';
import { SOFT_TAPER_MARGIN_MAG } from '../../solar-system/perceptual-magnitude';
import { CADENCE_JND_MAG } from '../../render-gate/cadence/clock-cadence-pure';
import {
  adaptationBranches,
  type AdaptationTuning,
  type FrameStatistic,
} from './scene-adaptation-pure';

/** Half an 8-bit output step: an encoded level under this rounds to
 *  0/255, i.e. the emitter is indistinguishable from the background. */
export const EIGHT_BIT_HALF_STEP = 0.5 / 255;

export interface EmitterInkArgs {
  /** Apparent magnitude as the SHADER sees it — dust extinction and any
   *  pulsation modulation already folded in, not the intrinsic value
   *  `apparentMagnitude` returns. */
  appMag: number;
  /** Live `uExposure`, so the adaptation cut and the EV trim are both
   *  already in it. */
  exposure: number;
  /** `uThresholdMag`, the taper's anchor. Adaptation is deliberately
   *  absent from it and rides `exposure` instead. */
  thresholdMag: number;
  /** True angular radius in CSS px, uncapped by the viewport fraction —
   *  what `pointSourcePeakLuminance` spreads the flux over. */
  physRadiusPx: number;
  /** `uWhitePoint`; follows the DR_MAG dev slider. */
  whitePoint: number;
  /** True for emitters the glow pass draws, where the soft taper
   *  applies. False for disc-dominated ones: the disc pass hard-cuts at
   *  the threshold and the glow pass has already excluded them, so the
   *  taper band renders nothing at all. */
  tapered: boolean;
}

export function taperFactor(
  appMag: number,
  thresholdMag: number,
  tapered: boolean,
): number {
  const over = appMag - thresholdMag;
  if (!tapered) return over > 0 ? 0 : 1;
  const t = Math.min(Math.max(over / SOFT_TAPER_MARGIN_MAG, 0), 1);
  return 1 - t * t * (3 - 2 * t);
}

/** The emitter's brightest pixel, encoded — 0…1 sRGB. */
export function emitterPeakDisplayLevel(a: EmitterInkArgs): number {
  const tap = taperFactor(a.appMag, a.thresholdMag, a.tapered);
  if (tap <= 0) return 0;
  const peak = pointSourcePeakLuminance(a.exposure, a.appMag, a.physRadiusPx);
  return displayLevel(peak * tap, a.whitePoint);
}

export function emitterPutsInkOnScreen(a: EmitterInkArgs): boolean {
  return emitterPeakDisplayLevel(a) >= EIGHT_BIT_HALF_STEP;
}

/** Everything the frame's exposure state offers a per-frame reader —
 *  stateless, storing nothing keyed on adaptation, which is the class
 *  README.md § One writer, five slots exempts. Null in chart, where the
 *  seam is off. */
export interface FrameExposure {
  /** Live `uExposure`: the adaptation cut and the EV trim are both in it. */
  readonly exposure: number;
  /** The instrument's own exposure at `dm = 0, ev = 0`. The reduction
   *  rescales `L̄` to it, so a share bound compared against `L̄` has to be
   *  built at it too. */
  readonly baseExposure: number;
  /** `uOmegaSummationArcsec2` — the rod summation area an extended
   *  source's DISPLAY level gains by. */
  readonly omegaSummationArcsec2: number;
  /** `uOmegaPxArcsec2` — the pixel solid angle the STATISTIC attachment
   *  takes instead. Read off the uniform the shaders read, so the CPU
   *  bound and the GPU write cannot disagree about the viewport. */
  readonly omegaPxArcsec2: number;
  /** `uWhitePoint`; follows the DR_MAG dev slider. */
  readonly whitePoint: number;
  /** The last landed reduction at the base exposure, or null before one
   *  has landed. Rule 2 needs `L̄`, so a null refuses every skip. */
  readonly statistic: FrameStatistic | null;
  readonly tuning: AdaptationTuning;
}

/** An extended emitter's brightest pixel, encoded — 0…1 sRGB. The
 *  point-source sibling's chain with two substitutions: the peak comes
 *  from a surface brightness over the rod summation area rather than a
 *  flux over a display kernel, and there is no soft taper, which is a
 *  point-source term. Unclamped by `LUMA_CEIL`, which would only ever
 *  lower the level and so make a skip likelier than the frame warrants. */
export function extendedEmitterPeakDisplayLevel(
  peakSb: number,
  exposure: number,
  omegaSummationArcsec2: number,
  whitePoint: number,
): number {
  return displayLevel(
    surfaceBrightnessLuminance(exposure, peakSb, omegaSummationArcsec2), whitePoint);
}

export function extendedEmitterPutsInkOnScreen(
  peakSb: number,
  exposure: number,
  omegaSummationArcsec2: number,
  whitePoint: number,
): boolean {
  return extendedEmitterPeakDisplayLevel(
    peakSb, exposure, omegaSummationArcsec2, whitePoint) >= EIGHT_BIT_HALF_STEP;
}

export interface BrightnessSkipArgs {
  /** Upper bound on the emitter's brightest rendered pixel, mag/arcsec².
   *  A bound, so it may only ever be BRIGHTER (numerically smaller) than
   *  the frame — which is what keeps a skip conservative. */
  peakSb: number;
  /** Whether this emitter's light is in the last landed statistic. Its
   *  share is subtracted while drawn and never while skipped: a skipped
   *  emitter is already out of `L̄`, and subtracting again double-eases
   *  the test and can readmit an emitter whose own return re-skips it. */
  contributing: boolean;
  /** No skip mid-warp: the band is the warp's realism payoff, and a warp
   *  snaps the measurement rather than slewing it. */
  warpActive: boolean;
  exposure: FrameExposure;
}

/**
 * Whether a diffuse emitter may skip its draw and its statistic write —
 * `docs/science-hdr-pipeline.md` § 3.5, which owns the derivation, the
 * probe table and the rejected alternatives.
 *
 * The two rules that close the exposure feedback loop: a drawn emitter
 * skips only if it is invisible at the exposure that will obtain WITHOUT
 * it, and only if that shift is under `CADENCE_JND_MAG` — so the skip is
 * imperceptible on everything else in frame.
 */
export function brightnessSkip(a: BrightnessSkipArgs): 'brightness' | null {
  const { statistic, tuning } = a.exposure;
  if (a.warpActive || statistic === null) return null;

  // ΔL_E ≤ f_E · uExposure_base · 10^(−0.4·S_peak) · Ω_px, at f_E = 1 —
  // the emitter over the whole frame, the worst case the frame fraction
  // can take. The peak over the whole footprint grossly overstates the
  // mean and is still tiny, because the statistic takes Ω_px where the
  // display takes Ω_sum.
  const share = a.contributing
    ? surfaceBrightnessLuminance(
      a.exposure.baseExposure, a.peakSb, a.exposure.omegaPxArcsec2)
    : 0;
  const withE = adaptationBranches(statistic, tuning).dm;
  const withoutE = adaptationBranches(
    { ...statistic, meanL: Math.max(statistic.meanL - share, 0) }, tuning).dm;
  // Removing light can only EASE the cut, so this is ≥ 0 up to rounding.
  const easing = withoutE - withE;
  if (easing > CADENCE_JND_MAG) return null;

  const easedExposure = a.exposure.exposure * 10 ** (0.4 * easing);
  return extendedEmitterPutsInkOnScreen(
    a.peakSb, easedExposure, a.exposure.omegaSummationArcsec2, a.exposure.whitePoint)
    ? null
    : 'brightness';
}

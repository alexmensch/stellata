// Whether an emitter puts a non-zero pixel on screen: its display
// kernel's peak carried through the soft taper, the faint-end toe and
// the operator. See README.md § What "visible" means to a pick path.

import { pointSourcePeakLuminance } from '../emission/emission-pure';
import { displayLevel } from '../tonemap/tonemap-pure';
import { SOFT_TAPER_MARGIN_MAG } from '../../solar-system/perceptual-magnitude';

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

// The exposure control: which magnitude limit the scene is exposed for,
// and the instrument multipliers an epoch rides on. See README.md
// § Exposure epochs.

import { NAKED_EYE_LIMIT_MAG } from '../filters/filter-state';
import { L_THRESH } from './tonemap-pure';

/** An observing instrument as a pair of multipliers on the base epoch. */
export interface InstrumentEpoch {
  /** Aperture gain over the unaided eye, in linear flux. */
  exposureMul: number;
  /** Angular magnification. The resolution half of the pair: it divides
   *  the PSF / exaggeration-K arcsec targets `filters/filter-state.ts`
   *  derives, which no instrument preset supplies yet. */
  angularMag: number;
}

/** The unaided eye — identity on both multipliers. */
export const UNAIDED_EYE: InstrumentEpoch = { exposureMul: 1, angularMag: 1 };

/** `uExposure` for a magnitude limit — the luminance a source at m = 0
 *  carries, fixed so a source at `magLimit` lands exactly on
 *  `L_THRESH`. */
export function exposureForMagLimit(magLimit: number, lThresh = L_THRESH): number {
  return lThresh * 10 ** (0.4 * magLimit);
}

/** `uExposure` for an observing epoch: the magnitude limit the user asked
 *  for, times the instrument's aperture gain. */
export function epochExposure(
  magLimit: number,
  instrument: InstrumentEpoch = UNAIDED_EYE,
): number {
  return exposureForMagLimit(magLimit) * instrument.exposureMul;
}

/** The base exposure epoch: every light decision in the scene grounds on
 *  the unaided eye at the naked-eye preset. */
export const BASE_EPOCH_EXPOSURE = epochExposure(NAKED_EYE_LIMIT_MAG);

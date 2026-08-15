// The pinned froxel geometry the client fill, the accuracy sweep and the cost
// model share, and the display patch all three are scored over.

import { ARCSEC_TO_RAD } from '../../util/astronomy-constants';
import { DEFAULT_SUMMATION_ARCSEC2 } from '../../hdr/exposure/exposure-epoch';

export const ARCMIN_TO_RAD = 60 * ARCSEC_TO_RAD;

/** Radius of the equal-area flat disc the resolve convolves the band over. */
export const PATCH_RADIUS_RAD =
  Math.sqrt(DEFAULT_SUMMATION_ARCSEC2 / Math.PI) * ARCSEC_TO_RAD;

export const PATCH_DIAMETER_ARCMIN = (2 * PATCH_RADIUS_RAD) / ARCMIN_TO_RAD;

/** The pin: one patch diameter per cell, so the grid carries no angular
 *  structure the display can resolve and none it cannot. */
export const PINNED_CELL_RAD = 2 * PATCH_RADIUS_RAD;
export const PINNED_SLICES = 32;

/** Fill rate along each cell ray, in samples per voxel. The accuracy sweep,
 *  the fetch counts and the GPU fill must read the same value or they price
 *  different grids. */
export const PINNED_FILL_STEPS_PER_VOXEL = 2;

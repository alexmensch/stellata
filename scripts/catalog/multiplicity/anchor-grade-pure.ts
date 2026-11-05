/** The anchor-grade bar. See README.md#system-distance-coherence. */

import type { GaiaAstrometryCatalogRow } from '../sources/gaia-astrometry-source';
import {
  GAIA_IPD_FRAC_MULTI_PEAK_THRESHOLD, GAIA_RUWE_UNRELIABLE_THRESHOLD,
} from '../distance/direction-cascade';

/** Gaia saturates brighter than G ≈ 3; a brighter source's 5p parallax
 *  is not trustworthy enough to anchor a system's distance. */
export const GAIA_UNSATURATED_G_MIN = 3.0;

/** A solution this rejects publishes a formal sigma that understates its own
 *  error, so nothing may be placed on it. */
export function isCoherenceAnchorGrade(g: GaiaAstrometryCatalogRow): boolean {
  return g.parallaxMas !== null && g.parallaxMas > 0
    && (g.ruwe === null || g.ruwe <= GAIA_RUWE_UNRELIABLE_THRESHOLD)
    && (g.ipdFracMultiPeak === null
      || g.ipdFracMultiPeak <= GAIA_IPD_FRAC_MULTI_PEAK_THRESHOLD)
    && g.gMag !== null && g.gMag >= GAIA_UNSATURATED_G_MIN;
}

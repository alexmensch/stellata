/** The anchor-grade bar. See README.md#system-distance-coherence. */

import type { GaiaAstrometryCatalogRow } from '../distance/direction-cascade';
import { GAIA_RUWE_UNRELIABLE_THRESHOLD } from '../distance/direction-cascade';

/** Gaia saturates brighter than G ≈ 3; a brighter source's 5p parallax
 *  is not trustworthy enough to anchor a system's distance. */
export const GAIA_UNSATURATED_G_MIN = 3.0;

/** Gaia's ipd_frac_multi_peak is a PERCENT (0–100), not a fraction —
 *  AU Mic carries 1 (1%, clean). Distinct from direction-cascade's
 *  GAIA_IPD_FRAC_MULTI_PEAK_THRESHOLD, which compares the same column on
 *  the fraction scale; there the NSS-membership requirement masks the
 *  difference, so do not read the two as one threshold. */
export const ANCHOR_IPD_MAX_PERCENT = 2.0;

/** A solution this rejects publishes a formal sigma that understates its own
 *  error, so nothing may be placed on it. */
export function isCoherenceAnchorGrade(g: GaiaAstrometryCatalogRow): boolean {
  return g.parallaxMas !== null && g.parallaxMas > 0
    && (g.ruwe === null || g.ruwe <= GAIA_RUWE_UNRELIABLE_THRESHOLD)
    && (g.ipdFracMultiPeak === null
      || g.ipdFracMultiPeak <= ANCHOR_IPD_MAX_PERCENT)
    && g.gMag !== null && g.gMag >= GAIA_UNSATURATED_G_MIN;
}

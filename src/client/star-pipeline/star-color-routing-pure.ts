// Canonical six-tier `pickTeffSource` routing for the star-colour LUT
// input. See src/client/star-pipeline/README.md.

import { ballesterosTeff } from '../../../scripts/colour/blackbody-lut-pure';
import {
  SOLAR_BV_FALLBACK,
  tempKelvin,
  type SpectralInfo,
} from '../../../scripts/catalog/catalog-pure';

export type TeffSource =
  | 'apsis-phot'
  | 'apsis-spec'
  | 'ballesteros'
  | 'spectral'
  | 'wd'
  | 'solar';

/** Sentinel float written to the per-instance Apsis Teff attribute when
 *  no Apsis Teff is available. 0.0 is unambiguous — Apsis Teff is always
 *  positive when present, so the shader can gate with `iTeffApsis > 0.0`. */
export const NO_APSIS_TEFF = 0;

/** Input record for the six-tier picker. `bv` is null when AT-HYG
 *  carried no `ci` cell (distinguishes the genuine-B-V tier from the
 *  solar-fallback tier). `spectralInfo` is the parsed AT-HYG `spect`
 *  cell; null when unparseable. */
export interface ColorRoutingRecord {
  teffGspphot: number | null;
  teffGspspec: number | null;
  bv: number | null;
  spectralInfo: SpectralInfo | null;
}

export interface TeffPick {
  teff: number;
  source: TeffSource;
}

/** Six-tier Teff routing. First match wins; tier order matches the
 *  bead's documented priority. */
export function pickTeffSource(rec: ColorRoutingRecord): TeffPick {
  if (rec.teffGspphot !== null && rec.teffGspphot > 0) {
    return { teff: rec.teffGspphot, source: 'apsis-phot' };
  }
  if (rec.teffGspspec !== null && rec.teffGspspec > 0) {
    return { teff: rec.teffGspspec, source: 'apsis-spec' };
  }
  if (rec.bv !== null) {
    return { teff: ballesterosTeff(rec.bv), source: 'ballesteros' };
  }
  if (rec.spectralInfo !== null) {
    if (rec.spectralInfo.isWhiteDwarf) {
      return { teff: tempKelvin(rec.spectralInfo), source: 'wd' };
    }
    // 8 = catalog-pure's `classIdx` for an unparseable / unknown class.
    // Treat that as no spectral info for routing purposes and fall through.
    if (rec.spectralInfo.classIdx !== 8) {
      return { teff: tempKelvin(rec.spectralInfo), source: 'spectral' };
    }
  }
  return { teff: ballesterosTeff(SOLAR_BV_FALLBACK), source: 'solar' };
}

/** Best Apsis Teff for the shader-side per-instance attribute. Picks
 *  gspphot over gspspec when both are present; returns NO_APSIS_TEFF
 *  when neither is available. Bridges the v6 catalog fields to the
 *  single-float `iTeffApsis` attribute the vertex shader reads. */
export function bestApsisTeff(
  teffGspphot: number,
  teffGspspec: number,
): number {
  if (Number.isFinite(teffGspphot) && teffGspphot > 0) return teffGspphot;
  if (Number.isFinite(teffGspspec) && teffGspspec > 0) return teffGspspec;
  return NO_APSIS_TEFF;
}

// Test-only builder for GaiaAstrometryCatalogRow. See README.md.

import type { GaiaAstrometryCatalogRow } from './direction-cascade';

/** A row with every optional column absent, so a suite states only the columns
 *  its assertion turns on. Parallax is one of them, which makes the default a
 *  2p (position-only) row — state `parallaxMas` to get a 5p one. Centralising
 *  the roster is the point: a column added to the interface lands here once
 *  instead of in every suite that happens to build a row. */
export function gaiaAstrometryRow(
  overrides: Partial<GaiaAstrometryCatalogRow> = {},
): GaiaAstrometryCatalogRow {
  return {
    raDeg: 0,
    decDeg: 0,
    parallaxMas: null,
    parallaxErrorMas: null,
    pmraMasyr: null,
    pmdecMasyr: null,
    ruwe: null,
    ipdFracMultiPeak: null,
    gMag: null,
    bpMag: null,
    rpMag: null,
    radialVelocityKmS: null,
    radialVelocityErrorKmS: null,
    ...overrides,
  };
}

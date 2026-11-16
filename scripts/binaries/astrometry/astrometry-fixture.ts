// Test-only: one measured component, a clean Gaia 5p row unless the test overrides it.

import { GAIA_ASTROMETRY } from '../../catalog/sources/gaia-astrometry-source';
import { sourceRowRef } from '../../util/sources/row-ref-pure';
import type { MeasuredAstrometry } from './routes-pure';

export function measured(over: Partial<MeasuredAstrometry> = {}): MeasuredAstrometry {
  return {
    astrometryVia: 'gaia_5p', raDeg: 100.0, decDeg: 0.0, parallaxMas: 10.0, parallaxErrorMas: 0.05,
    pmraMasyr: 1.0, pmdecMasyr: -1.0, refEpoch: 2016.0, from: sourceRowRef(GAIA_ASTROMETRY, '1'), ...over,
  };
}

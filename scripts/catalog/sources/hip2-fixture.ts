// Test-only builder for Hip2AstrometryRow. See README.md.

import { sourceRowRef } from '../../util/sources/row-ref-pure';
import { HIP2, type Hip2AstrometryRow } from './hip2-source';

/** A row with every nullable column absent, so a suite states only the columns its assertion turns on. */
export function hip2AstrometryRow(overrides: Partial<Hip2AstrometryRow> = {}): Hip2AstrometryRow {
  return {
    raDeg: 0, decDeg: 0, plxMas: null, plxErrorMas: null, pmRaMasyr: null, pmDeMasyr: null,
    ref: sourceRowRef(HIP2, 0),
    ...overrides,
  };
}

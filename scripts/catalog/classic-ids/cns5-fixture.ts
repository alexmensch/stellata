// Test-only Cns5Row / Cns5Astrometry builders. A module rather than an export
// from one test file: four suites across two folders build these, so a column
// added to either interface lands in one place, not in every literal.

import { sourceRowRef } from '../../util/sources/row-ref-pure';
import type { Cns5Astrometry, Cns5Row } from './classic-ids-parse';
import { CNS5 } from './cns5-source';

const REF = sourceRowRef(CNS5, 1);

export function cns5Astrometry(
  overrides: Partial<Cns5Astrometry> = {},
): Cns5Astrometry {
  return {
    raDeg: 70,
    decDeg: -7,
    posEpoch: 2000.0,
    parallax: { mas: 100, errMas: 0.5, bibcode: '2020yCat.1350....0G', ref: REF },
    pm: { pmRaMasyr: 50, pmDecMasyr: -20, bibcode: '2012yCat.1322....0Z', ref: REF },
    ...overrides,
  };
}

export function cns5Row(overrides: Partial<Cns5Row> = {}): Cns5Row {
  return {
    cns5: 1,
    gj: '1',
    gjComp: null,
    hip: null,
    gaiaSourceId: null,
    astrometry: null,
    ...overrides,
  };
}

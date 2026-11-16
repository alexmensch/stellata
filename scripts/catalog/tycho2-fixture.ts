// Test-only builder for Tycho2Row. See README.md.

import { sourceRowRef } from '../util/sources/row-ref-pure';
import { TYCHO2_ICRS_EPOCH, TYCHO2_MEAN_EPOCH, type Tycho2Row } from './tycho2-parse';
import { TYCHO2 } from './tycho2-source';

/** A main-table row with a mean solution and every nullable column absent,
 *  so a suite states only the columns its assertion turns on. The observed
 *  cell defaults to the row's position. */
export function tycho2Row(tyc: string, overrides: Partial<Tycho2Row> = {}): Tycho2Row {
  const raDeg = overrides.raDeg ?? 0;
  const decDeg = overrides.decDeg ?? 0;
  return {
    raDeg, decDeg, epoch: TYCHO2_MEAN_EPOCH,
    pmRaMasyr: null, pmDecMasyr: null, btMag: null, vtMag: null,
    fromIcrs: false, isPhotocentre: false, hip: null,
    observed: { raDeg, decDeg, raEpoch: TYCHO2_ICRS_EPOCH, decEpoch: TYCHO2_ICRS_EPOCH },
    ref: sourceRowRef(TYCHO2, tyc),
    ...overrides,
  };
}

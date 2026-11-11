import { describe, expect, it } from 'vitest';

import {
  MULTIPLICITY_RESOLVED, MULTIPLICITY_SINGLE, MULTIPLICITY_UNRESOLVED,
} from '../../../src/catalog-format/record/catalog-pure';
import { multiplicityStatuses, multiplicitySummary } from './multiplicity-stage-pure';

describe('multiplicityStatuses', () => {
  it('marks resolved members first, then SIMBAD multiples among the rest', () => {
    const records = [{ gaiaSourceId: '1' }, { gaiaSourceId: '2' }, { gaiaSourceId: null }, { gaiaSourceId: '4' }];
    const multiple = new Set(['1', '2']);
    const { status, counts } = multiplicityStatuses(records, new Set([0]), (id) => multiple.has(id));
    expect([...status]).toEqual([MULTIPLICITY_RESOLVED, MULTIPLICITY_UNRESOLVED, MULTIPLICITY_SINGLE, MULTIPLICITY_SINGLE]);
    expect(counts).toEqual({ multiplicityResolved: 1, multiplicityUnresolved: 1 });
  });
});

describe('multiplicitySummary', () => {
  it('states every count of the block', () => {
    expect(multiplicitySummary({
      binaryPairs: 1, binaryMutualPairs: 2, ccdmGroups: 3, ccdmResolved: 4, ccdmFlagged: 5, ccdmSuppressedOptical: 6,
      eclipsingWinged: 7, renderableCompanionWinged: 8, componentDesignations: 9, multiplicityResolved: 10,
      multiplicityUnresolved: 11,
    })).toBe(
      'multiplicity: 1 companion assignments, 2 mutual pairs; CCDM 3 systems → 4 resolved in catalog, '
        + '5 new primaries flagged, 6 suppressed as optical doubles; wings on 7 eclipsing binaries and '
        + "8 renderable-companion primaries; 9 component designations; 10 resolved, 11 unresolved (SIMBAD '**', nothing resolved)",
    );
  });
});

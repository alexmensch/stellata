import { describe, it, expect } from 'vitest';

import {
  SOL_ABSOLUTE_V_MAGNITUDE,
  SOL_APPARENT_V_MAGNITUDE,
} from '../../../src/catalog-format/record/catalog-pure';
import { manifestRecord, type ManifestColumn } from '../membership/membership-manifest-tsv';
import { CURATED_RECORDS } from './curated-records';

const row = (cells: Partial<Record<ManifestColumn, string>>) => manifestRecord(
  (c) => cells[c] ?? ({ binding: 'none', term: 'primaries', origin_key: 'spine:1' } as Partial<Record<ManifestColumn, string>>)[c] ?? '',
  (m) => { throw new Error(m); },
);

describe('CURATED_RECORDS', () => {
  it('answers for the row whose identity is Sol, and for no other', () => {
    expect(CURATED_RECORDS(row({ proper: 'Sol' }))).toMatchObject({
      placement: { absoluteVMagnitude: SOL_ABSOLUTE_V_MAGNITUDE },
      vMagnitude: SOL_APPARENT_V_MAGNITUDE,
      direction: { velVia: 'zero', srcPmraMasyr: null, srcPmdecMasyr: null },
      spectral: { spectDisplay: 'G2V', info: { kind: 'mk' } },
    });
    expect(CURATED_RECORDS(row({ proper: 'Sirius', hip: '32349' }))).toBeNull();
  });
});

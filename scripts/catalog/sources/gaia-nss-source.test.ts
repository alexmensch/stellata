import { describe, it, expect } from 'vitest';
import { GAIA_NSS, parseNssIndex } from './gaia-nss-source';
import { sourceRowRef } from '../../util/sources/row-ref-pure';
import { columnTable } from '../../util/tsv/table-pure';

describe('gaia-nss-source', () => {
  it('parseNssIndex collects the source_id column', () => {
    const tsv = [
      'source_id\tnss_solution_type\tperiod',
      '111\tOrbital\t500',
      '111\tSB1\t500',
      '222\tEclipsingBinary\t3',
    ].join('\n');
    const index = parseNssIndex(columnTable({ file: 'fixture/nss.tsv', hint: 'h' }, tsv), GAIA_NSS);
    expect(index.size).toBe(2);
    expect(index.get('111')).toEqual(sourceRowRef(GAIA_NSS, '111'));
    expect(index.has('222')).toBe(true);
  });
});

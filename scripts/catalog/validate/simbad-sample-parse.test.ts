import { describe, it, expect } from 'vitest';

import { parseSimbadSampleRows } from './simbad-sample-parse';

describe('parseSimbadSampleRows', () => {
  it('parses every required column into typed fields', () => {
    const tsv = [
      'simbad_oid\tsimbad_main_id\thip\tgaia_source_id\tra\tdec\tplx_value\tplx_err\tpmra\tpmdec\tv_mag\tdistance_pc\tabsmag\tsp_type\totype',
      '22\tBD+36 1\t\t100\t10\t20\t1.9\t0.02\t7.1\t-3.5\t9.25\t524.9\t0.65\tK0\t*',
      '33\tHD 1\t103799\t200\t11\t21\t2.7\t0.02\t12.0\t24.0\t8.0\t367.9\t0.17\tK5\t*',
    ].join('\n');
    const rows = parseSimbadSampleRows(tsv);
    expect(rows).toHaveLength(2);
    expect(rows[0].hip).toBeNull();
    expect(rows[0].gaiaSourceId).toBe('100');
    expect(rows[0].pmra).toBeCloseTo(7.1, 9);
    expect(rows[0].absmag).toBeCloseTo(0.65, 9);
    expect(rows[1].hip).toBe(103799);
  });

  it('returns null for missing numeric cells rather than NaN', () => {
    const tsv = [
      'simbad_oid\tsimbad_main_id\thip\tgaia_source_id\tplx_value\tplx_err\tpmra\tpmdec\tv_mag\tdistance_pc\tabsmag',
      '1\tX\t\t\t\t\t\t\t\t\t',
    ].join('\n');
    const [row] = parseSimbadSampleRows(tsv);
    expect(row.plxValue).toBeNull();
    expect(row.pmra).toBeNull();
    expect(row.absmag).toBeNull();
  });

  it('throws naming the column when a required header is absent', () => {
    expect(() => parseSimbadSampleRows('simbad_oid\thip\n1\t100\n')).toThrow(
      /missing required column: simbad_main_id/,
    );
  });

  it('returns no rows for an empty file or a header with no data rows', () => {
    expect(parseSimbadSampleRows('')).toEqual([]);
    expect(parseSimbadSampleRows(
      'simbad_oid\tsimbad_main_id\thip\tgaia_source_id\tplx_value\tplx_err\tpmra\tpmdec\tv_mag\tdistance_pc\tabsmag\n',
    )).toEqual([]);
  });
});

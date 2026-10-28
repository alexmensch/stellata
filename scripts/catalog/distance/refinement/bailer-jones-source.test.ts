import { describe, expect, it } from 'vitest';

import { parseBailerJonesTsv } from './bailer-jones-source';

const FROM = { file: 'fixture.tsv', hint: 'h' };

describe('parseBailerJonesTsv', () => {
  it('parses source_id as string and prefers r_med_photogeo', () => {
    const tsv =
      'source_id\tr_med_geo\tr_lo_geo\tr_hi_geo\tr_med_photogeo\tr_lo_photogeo\tr_hi_photogeo\tflag\n' +
      '204531088580182016\t6366.668\t6300\t6420\t6244.791\t6200\t6280\t10033\n' +
      '4773096563064098432\t93.528\t92\t94\t92.871\t92\t93\t10023\n';
    const map = parseBailerJonesTsv(tsv, FROM);
    expect(map.size).toBe(2);
    expect(map.get('204531088580182016')).toBe(6244.791);
    expect(map.get('4773096563064098432')).toBe(92.871);
  });

  it('falls back to r_med_geo when r_med_photogeo is empty', () => {
    const tsv =
      'source_id\tr_med_geo\tr_lo_geo\tr_hi_geo\tr_med_photogeo\tr_lo_photogeo\tr_hi_photogeo\tflag\n' +
      '123\t250.0\t245\t255\t\t\t\t33333\n';
    const map = parseBailerJonesTsv(tsv, FROM);
    expect(map.get('123')).toBe(250.0);
  });

  it('throws on missing required columns', () => {
    expect(() => parseBailerJonesTsv('source_id\tr_med_geo\n1\t10\n', FROM))
      .toThrow(/r_med_photogeo/);
  });

  it('skips rows with non-positive distance and blank source_ids', () => {
    const tsv =
      'source_id\tr_med_geo\tr_lo_geo\tr_hi_geo\tr_med_photogeo\tr_lo_photogeo\tr_hi_photogeo\tflag\n' +
      '\t10\t9\t11\t10\t9\t11\t1\n' +
      '999\t-1\t-1\t-1\t\t\t\t1\n' +
      '111\t100\t99\t101\t99\t98\t100\t1\n';
    const map = parseBailerJonesTsv(tsv, FROM);
    expect(map.size).toBe(1);
    expect(map.get('111')).toBe(99);
  });
});

import { describe, it, expect } from 'vitest';
import { HIP2, parseHip2Tsv } from './hip2-source';
import { sourceRowRef } from '../../util/sources/row-ref-pure';

describe('hip2-source', () => {
  it('parseHip2Tsv decodes rows keyed by HIP', () => {
    const tsv = [
      'hip\tra_icrs\tde_icrs\tplx\te_plx\tpm_ra\tpm_de\te_pm_ra\te_pm_de\tgoodness_of_fit\tn_transits',
      '32349\t101.28854105\t-16.71314306\t379.21\t1.58\t-546.01\t-1223.07\t1.33\t1.24\t0.99\t100',
      '\t\t\t\t\t\t\t\t\t\t',
    ].join('\n');
    const map = parseHip2Tsv(tsv, HIP2).astrometry;
    expect(map.size).toBe(1);
    expect(map.get(32349)).toEqual({
      raDeg: 101.28854105, decDeg: -16.71314306,
      plxMas: 379.21, plxErrorMas: 1.58,
      pmRaMasyr: -546.01, pmDeMasyr: -1223.07,
      ref: sourceRowRef(HIP2, 32349),
    });
  });

  it('parseHip2Tsv lists a HIP with no position among the published HIPs', () => {
    const tsv = [
      'hip\tra_icrs\tde_icrs\tplx\te_plx\tpm_ra\tpm_de',
      '32349\t101.2\t-16.7\t379.21\t1.58\t-546.01\t-1223.07',
      '7\t\t\t\t\t\t',
    ].join('\n');
    const { astrometry, hips } = parseHip2Tsv(tsv, HIP2);
    expect([...astrometry.keys()]).toEqual([32349]);
    expect([...hips]).toEqual([32349, 7]);
  });

  it('parseHip2Tsv stops on a HIP published twice, naming the second row', () => {
    const tsv = [
      'hip\tra_icrs\tde_icrs\tplx\te_plx\tpm_ra\tpm_de',
      '7\t\t\t\t\t\t',
      '32349\t101.2\t-16.7\t379.21\t1.58\t-546.01\t-1223.07',
      '7\t1.0\t2.0\t\t\t\t',
    ].join('\n');
    expect(() => parseHip2Tsv(tsv, HIP2)).toThrow(
      `${HIP2.file}:4: HIP 7 has more than one row; which was meant is not the reader's to guess. ${HIP2.hint}`,
    );
    const zeros = ['hip\tra_icrs\tde_icrs\tplx\te_plx\tpm_ra\tpm_de', '0\t\t\t\t\t\t', '0\t\t\t\t\t\t'].join('\n');
    expect(() => parseHip2Tsv(zeros, HIP2)).toThrow(`${HIP2.file}:3: HIP 0 has more than one row`);
  });
});

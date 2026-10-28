import { describe, expect, it } from 'vitest';

import { parseGaiaApsisTsv } from './gaia-apsis-source';

const FROM = { file: 'fixture.tsv', hint: 'h' };

describe('parseGaiaApsisTsv', () => {
  const HDR =
    'source_id\tteff_gspphot\tlogg_gspphot\tmh_gspphot\tazero_gspphot\t' +
    'teff_gspspec\tlogg_gspspec\tmh_gspspec\tspectraltype_esphs\n';

  it('parses source_id as string, both gspphot and gspspec triples, plus the esphs enum', () => {
    const tsv = HDR +
      '7632157690368\t5028.8\t3.1614\t-0.1016\t0.2131\t4864.0\t2.6600\t-0.2000\tK\n' +
      '44358422235136\t5787.8\t4.3140\t0.3385\t0.0648\t\t\t\tG\n';
    const map = parseGaiaApsisTsv(tsv, FROM);
    expect(map.size).toBe(2);
    const a = map.get('7632157690368')!;
    expect(a.teffGspphot).toBe(5028.8);
    expect(a.loggGspphot).toBe(3.1614);
    expect(a.mhGspphot).toBe(-0.1016);
    expect(a.azeroGspphot).toBe(0.2131);
    expect(a.teffGspspec).toBe(4864.0);
    expect(a.loggGspspec).toBe(2.6600);
    expect(a.mhGspspec).toBe(-0.2000);
    expect(a.spectraltypeEsphs).toBe('K');
    const b = map.get('44358422235136')!;
    expect(b.teffGspphot).toBe(5787.8);
    expect(b.teffGspspec).toBeNull();
    expect(b.loggGspspec).toBeNull();
    expect(b.mhGspspec).toBeNull();
    expect(b.spectraltypeEsphs).toBe('G');
  });

  it('decodes blank cells as null without dropping the row', () => {
    const tsv = HDR + '999\t\t\t\t\t6000\t4.0\t0.0\t\n';
    const map = parseGaiaApsisTsv(tsv, FROM);
    const r = map.get('999')!;
    expect(r.teffGspphot).toBeNull();
    expect(r.loggGspphot).toBeNull();
    expect(r.mhGspphot).toBeNull();
    expect(r.azeroGspphot).toBeNull();
    expect(r.teffGspspec).toBe(6000);
    expect(r.loggGspspec).toBe(4.0);
    expect(r.mhGspspec).toBe(0.0);
    expect(r.spectraltypeEsphs).toBeNull();
  });

  it('skips rows with a blank source_id', () => {
    const tsv = HDR + '\t5000\t4\t0\t0\t5000\t4\t0\tG\n';
    const map = parseGaiaApsisTsv(tsv, FROM);
    expect(map.size).toBe(0);
  });

  it('throws on missing required columns', () => {
    expect(() => parseGaiaApsisTsv('source_id\tteff_gspphot\n1\t5000\n', FROM))
      .toThrow(/azero_gspphot|logg_gspphot|mh_gspphot|teff_gspspec|spectraltype_esphs/);
  });
});

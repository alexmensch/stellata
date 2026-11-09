import { describe, it, expect } from 'vitest';
import {
  GAIA_ASTROMETRY, gaiaAstrometryAccumulator, gaiaAstrometryLineReader, parseGaiaAstrometryCatalogTsv,
} from './gaia-astrometry-source';
import { MAGNITUDE_PULL } from '../membership/magnitude-term/magnitude-pull-source';
import { sourceRowRef } from '../../util/sources/row-ref-pure';

describe('gaia-astrometry-source', () => {
  it('parseGaiaAstrometryCatalogTsv decodes rows and null cells', () => {
    const tsv = [
      'source_id\tra\tra_error\tdec\tdec_error\tparallax\tparallax_error\tpmra\tpmra_error\tpmdec\tpmdec_error\tref_epoch\truwe\tipd_frac_multi_peak\tphot_g_mean_mag\tphot_bp_mean_mag\tphot_rp_mean_mag\tradial_velocity\tradial_velocity_error',
      '123\t100.5\t0.1\t-20.25\t0.1\t50.0\t0.1\t10.5\t0.1\t-3.5\t0.1\t2016.0\t1.2\t0\t8.0\t8.6\t7.3\t-110.51\t0.22',
      '456\t200.0\t\t30.0\t\t\t\t\t\t\t\t2016.0\t\t\t9.0\t\t\t\t',
      '',
    ].join('\n');
    const map = parseGaiaAstrometryCatalogTsv(tsv, GAIA_ASTROMETRY);
    expect(map.size).toBe(2);
    expect(map.get('123')).toEqual({
      raDeg: 100.5, decDeg: -20.25,
      parallaxMas: 50.0, parallaxErrorMas: 0.1,
      pmraMasyr: 10.5, pmdecMasyr: -3.5,
      ruwe: 1.2, ipdFracMultiPeak: 0,
      gMag: 8.0, bpMag: 8.6, rpMag: 7.3,
      radialVelocityKmS: -110.51,
      radialVelocityErrorKmS: 0.22,
      ref: sourceRowRef(GAIA_ASTROMETRY, '123'),
    });
    expect(map.get('456')).toEqual({
      raDeg: 200.0, decDeg: 30.0,
      parallaxMas: null, parallaxErrorMas: null,
      pmraMasyr: null, pmdecMasyr: null,
      ruwe: null, ipdFracMultiPeak: null,
      gMag: 9.0, bpMag: null, rpMag: null,
      radialVelocityKmS: null,
      radialVelocityErrorKmS: null,
      ref: sourceRowRef(GAIA_ASTROMETRY, '456'),
    });
  });

  it('parseGaiaAstrometryCatalogTsv throws on a missing column', () => {
    expect(() => parseGaiaAstrometryCatalogTsv('source_id\tra\tdec\n', GAIA_ASTROMETRY)).toThrow(/missing required columns/);
  });

  it('gaiaAstrometryAccumulator keeps only the requested sources', () => {
    const lines = [
      'source_id\tra\tra_error\tdec\tdec_error\tparallax\tparallax_error\tpmra\tpmra_error\tpmdec\tpmdec_error\tref_epoch\truwe\tipd_frac_multi_peak\tphot_g_mean_mag\tphot_bp_mean_mag\tphot_rp_mean_mag\tradial_velocity\tradial_velocity_error',
      '123\t100.5\t0.1\t-20.25\t0.1\t50.0\t0.1\t10.5\t0.1\t-3.5\t0.1\t2016.0\t1.2\t0\t8.0\t8.6\t7.3\t-110.51\t0.22',
      '456\t200.0\t\t30.0\t\t\t\t\t\t\t\t2016.0\t\t\t9.0\t\t\t\t',
    ];
    const acc = gaiaAstrometryAccumulator(MAGNITUDE_PULL, new Set(['456']));
    for (const line of lines) acc.line(line);
    const map = acc.result();
    expect([...map.keys()]).toEqual(['456']);
    expect(map.get('456')?.raDeg).toBe(200.0);
  });

  it('gaiaAstrometryLineReader hands every row on, and the whole-text parse folds the same rows', () => {
    const lines = [
      'source_id\tra\tra_error\tdec\tdec_error\tparallax\tparallax_error\tpmra\tpmra_error\tpmdec\tpmdec_error\tref_epoch\truwe\tipd_frac_multi_peak\tphot_g_mean_mag\tphot_bp_mean_mag\tphot_rp_mean_mag\tradial_velocity\tradial_velocity_error',
      '123\t100.5\t0.1\t-20.25\t0.1\t50.0\t0.1\t10.5\t0.1\t-3.5\t0.1\t2016.0\t1.2\t0\t8.0\t8.6\t7.3\t-110.51\t0.22',
      '456\t200.0\t\t30.0\t\t\t\t\t\t\t\t2016.0\t\t\t9.0\t\t\t\t',
    ];
    const seen = new Map<string, unknown>();
    const read = gaiaAstrometryLineReader(GAIA_ASTROMETRY, (sourceId, row) => seen.set(sourceId, row));
    for (const line of lines) read(line);
    expect(seen).toEqual(parseGaiaAstrometryCatalogTsv(lines.join('\n'), GAIA_ASTROMETRY));
  });

  it('gaiaAstrometryAccumulator resolves source_id by name, not by position', () => {
    const acc = gaiaAstrometryAccumulator(MAGNITUDE_PULL, new Set(['123']));
    acc.line('ra\tsource_id\tra_error\tdec\tdec_error\tparallax\tparallax_error\tpmra\tpmra_error\tpmdec\tpmdec_error\tref_epoch\truwe\tipd_frac_multi_peak\tphot_g_mean_mag\tphot_bp_mean_mag\tphot_rp_mean_mag\tradial_velocity\tradial_velocity_error');
    acc.line('100.5\t123\t0.1\t-20.25\t0.1\t50.0\t0.1\t10.5\t0.1\t-3.5\t0.1\t2016.0\t1.2\t0\t8.0\t8.6\t7.3\t-110.51\t0.22');
    expect(acc.result().get('123')?.raDeg).toBe(100.5);
  });
});

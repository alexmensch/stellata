import { describe, expect, it } from 'vitest';

import { columnTable } from '../../util/tsv/table-pure';
import { componentKey, discovererKey } from '../component-tokens-pure';
import { parseAthygRows } from './athyg-pure';
import {
  parseAstrometryExclusions, parseComponentSptypeOverrides, parseOrb6ComponentOverrides,
} from './curated-pure';
import { parseGaiaAstrometry, parseNssOrbits } from './gaia-pure';
import { FIXTURE } from './load-fixture';
import { parseMscOrbits, parseMscSystems } from './msc-pure';
import { joinSimbadWdsSpectra, parseSimbadWdsXids, parseSptypeByOid } from './simbad-pure';

const tsv = (text: string) => columnTable(FIXTURE, text);
const csv = (text: string) => columnTable({ ...FIXTURE, csv: true }, text);

const ATHYG_HEADER = '"id","tyc","gaia","hyg","hip","hd","hr","gl","bayer","flam","con",'
  + '"proper","ra","dec","pos_src","dist","x0","y0","z0","dist_src",'
  + '"mag","absmag","ci","mag_src","rv","rv_src","pm_ra","pm_dec",'
  + '"pm_src","vx","vy","vz","spect","spect_src"';

describe('parseAthygRows', () => {
  it('surfaces hip, tyc and gaia, RA in degrees', () => {
    const rows = parseAthygRows(csv([
      ATHYG_HEADER,
      '1,"",,0,,,"","","","","",Sol,0.0,0.0,OTHER,0.0,0.000005,0.0,0.0,OTHER,-26.7,4.85,0.656,OTHER,,OTHER,,,OTHER,,,,G2 V,OTHER',
      '21,"5841-1155-1",2341871673090078592,0,2,,"","","","","",,0.0008,75.48,Hip,219.30,55.93,0.42,212.74,Hip,9.27,-1.45,1.46,Hip,,OTHER,,,Hip,,,,K0V,Hip',
    ].join('\n')));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ proper: 'Sol', hip: null, tyc: null, gaia: null });
    expect(rows[1]).toMatchObject({ hip: 2, tyc: '5841-1155-1', gaia: '2341871673090078592', absmag: -1.45, ci: 1.46 });
    expect(rows[1].raDeg).toBeCloseTo(0.0008 * 15, 12);
  });

  it('reads `0` as an absent identifier', () => {
    const rows = parseAthygRows(csv([
      ATHYG_HEADER,
      '99,"0","0",0,0,0,"","","","","",Historical,1.0,10.0,OTHER,100.0,80.0,40.0,40.0,OTHER,8.5,5.0,0.5,OTHER,,OTHER,,,OTHER,,,,K0V,Hip',
    ].join('\n')));
    expect(rows[0]).toMatchObject({ hip: null, tyc: null, gaia: null, hd: null });
  });

  it('skips a row with no position or no absolute magnitude', () => {
    const rows = parseAthygRows(csv([
      ATHYG_HEADER,
      '2,"",,0,,,"","","","","",,,10.0,OTHER,100.0,80.0,40.0,40.0,OTHER,8.5,5.0,,OTHER,,OTHER,,,OTHER,,,,,',
      '3,"",,0,,,"","","","","",,1.0,10.0,OTHER,100.0,80.0,40.0,40.0,OTHER,8.5,,,OTHER,,OTHER,,,OTHER,,,,,',
    ].join('\n')));
    expect(rows).toEqual([]);
  });

  it('throws on a missing column rather than reading every row as absent', () => {
    const noDist = ATHYG_HEADER.replace('"dist",', '');
    expect(() => parseAthygRows(csv(`${noDist}\n1,"",,0,,,"","","","","",Sol,0.0,0.0,OTHER\n`)))
      .toThrow(/missing required columns: dist/);
  });
});

describe('curated tables', () => {
  it('reads ORB6 component overrides past the preamble', () => {
    const out = parseOrb6ComponentOverrides(
      '# preamble\nwds_id\tdiscoverer\tcomponents\tsource\n07346+3153\tYY Gem\tCa,Cb\tTorres & Ribas 2002\n', FIXTURE,
    );
    expect(out.get(discovererKey('07346+3153', 'YY Gem'))).toBe('Ca,Cb');
  });

  it('reads component sp_type overrides keyed on the raw comp form', () => {
    const out = parseComponentSptypeOverrides([
      '# preamble line', '# another', 'wds_id\tcomponent\tsp_type\tsource',
      '03082+4057\t2\tK0IV\tKolbas et al. 2015', '08447-5443\tAb\tA4V\tMerand et al. 2011',
    ].join('\n'), FIXTURE);
    expect(out).toEqual(new Map([[componentKey('03082+4057', '2'), 'K0IV'], [componentKey('08447-5443', 'Ab'), 'A4V']]));
  });

  it('refuses a curated row missing a cell it exists to state', () => {
    expect(() => parseComponentSptypeOverrides('wds_id\tcomponent\tsp_type\nX\tA\t\n', FIXTURE))
      .toThrow(/fixture\/binaries\.tsv:2: sp_type is empty/);
    expect(() => parseAstrometryExclusions('gaia_source_id\treason\n\tblank\n', FIXTURE))
      .toThrow(/fixture\/binaries\.tsv:2: gaia_source_id: is empty/);
  });

  it('reads astrometry exclusions by source_id', () => {
    const out = parseAstrometryExclusions(
      '# preamble\ngaia_source_id\tcomponent\twds_id\treason\n2947050466531873024\tB\t06451-1643\tSirius B blended\n', FIXTURE,
    );
    expect(out.get('2947050466531873024')).toContain('Sirius B');
  });
});

describe('parseGaiaAstrometry', () => {
  const HEADER = 'source_id\tra\tra_error\tdec\tdec_error\tparallax\tparallax_error\tpmra\tpmra_error\tpmdec\tpmdec_error'
    + '\tref_epoch\truwe\tipd_frac_multi_peak\tphot_g_mean_mag\tphot_bp_mean_mag\tphot_rp_mean_mag';

  it('reads every field', () => {
    const m = parseGaiaAstrometry(`${HEADER}\n2947050466531873024\t101.287155\t0.04\t-16.716116\t0.03\t374.49\t0.23\t-461.57\t0.05\t-914.52\t0.03\t2016.00\t1.78\t0.012\t-1.30\t-0.92\t-1.74\n`, FIXTURE);
    expect(m.get('2947050466531873024')).toMatchObject({
      pmraMasyr: -461.57, parallaxErrorMas: 0.23, pmraErrorMasyr: 0.05, pmdecErrorMasyr: 0.03,
      refEpoch: 2016, ruwe: 1.78, ipdFracMultiPeak: 0.012, gMag: -1.3,
    });
  });

  it('skips a row with no position, and throws on a missing column', () => {
    const m = parseGaiaAstrometry(`${HEADER}\n1\t10\t\t20\t\t5\t\t1\t\t1\t\t2016\t1\t0\t\t\t\n2\t\t\t30\t\t5\t\t1\t\t1\t\t2016\t1\t0\t\t\t\n`, FIXTURE);
    expect([...m.keys()]).toEqual(['1']);
    expect(() => parseGaiaAstrometry('source_id\tra\tdec\tref_epoch\n1\t10\t20\t2016\n', FIXTURE))
      .toThrow(/missing required columns: parallax/);
  });
});

describe('parseNssOrbits', () => {
  const header = 'source_id\tnss_solution_type\tperiod\tt_periastron\teccentricity\ta_thiele_innes\tb_thiele_innes'
    + '\tf_thiele_innes\tg_thiele_innes\tinclination\targ_periastron\tmass_ratio';

  it('throws on a renamed column rather than reading every orbit without it', () => {
    expect(() => parseNssOrbits(tsv(`${header.replace('\tperiod\t', '\torbital_period\t')}\n1\tSB1\t9.1\t\t\t\t\t\t\t\t\t\n`)))
      .toThrow(/missing required columns: period/);
  });

  it('reads the orbit columns; a repeated source keeps its last solution', () => {
    const m = parseNssOrbits(tsv(`${header}\n33711199137024\tOrbital\t773.09\t143.0\t0.33\t-0.83\t-0.69\t0.45\t-0.99\t\t\t\n33711199137024\tSB1\t916.98\t443.9\t0.09\t\t\t\t\t\t266.5\t\n`));
    expect(m.size).toBe(1);
    expect(m.get('33711199137024')).toMatchObject({ solutionType: 'SB1', period: 916.98, argPeriastron: 266.5, aThieleInnes: null });
  });
});

describe('SIMBAD WDS cross-IDs and spectra', () => {
  const XIDS = 'wds_id\tcomponent\tsimbad_oid\tsimbad_main_id\tgaia_source_id\thip';

  it('reads a full cross-reference, and an α Cen A-shaped blank source_id as absent', () => {
    const out = parseSimbadWdsXids(tsv(`${XIDS}\n00491+5749\tA\t106647\t* eta Cas\t425040000962559616\t3821\n14396-6050\tA\t3396054\t* alf Cen A\t\t71683\n`));
    expect(out.get(componentKey('00491+5749', 'A'))).toEqual({
      wdsId: '00491+5749', component: 'A', simbadOid: 106647, simbadMainId: '* eta Cas', gaiaSourceId: '425040000962559616', hip: 3821,
    });
    expect(out.get(componentKey('14396-6050', 'A'))).toMatchObject({ gaiaSourceId: null, hip: 71683 });
  });

  it('skips a row missing wds_id, component or oid', () => {
    expect(parseSimbadWdsXids(tsv(`${XIDS}\n\tA\t1\tx\t\t\nX\t\t2\tx\t\t\nX\tA\t\tx\t\t\n`)).size).toBe(0);
  });

  it('joins the sp_type pull on simbad_oid, typed components only, columns by name', () => {
    const xids = parseSimbadWdsXids(tsv([
      XIDS,
      '04153-0739\tA\t702026\t* omi02 Eri\t3195919528989223040\t19849',
      '04153-0739\tB\t701944\t* omi02 Eri B\t3195919254111315712\t',
      '06451-1643\tB\t8399846\t* alf CMa B\t\t',
      'X\tA\t999\tnomatch\t\t',
    ].join('\n')));
    const spByOid = parseSptypeByOid('sp_type\tsimbad_oid\nK0V\t702026\nDA2.9\t701944\n\t8399846\n', FIXTURE);
    expect(joinSimbadWdsSpectra(spByOid, xids)).toEqual(new Map([
      [componentKey('04153-0739', 'A'), 'K0V'],
      [componentKey('04153-0739', 'B'), 'DA2.9'],
    ]));
  });
});

describe('MSC tables', () => {
  it('reads systems through cells holding a literal `"`', () => {
    const rows = parseMscSystems([
      'wds_id\tprim\tsec\tparent\tobs_type\tper\tper_unit\tsep\tsep_unit\tpa_deg\tvmag1\tspt1\tvmag2\tspt2\tmass1_msun\tmass2_msun',
      '00003-4417\tAB\tC\t*\tCmp\t107.0695\tk\t40.443\t"\t318.2\t17.68\t\t19.89\t\t3.15\t0.13',
      '00003-4417\tA\tB\tAB\tV\t119.1\ty\t0.424\t"\t327.0\t6.8\tG3IV\t7.56\t\t1.7\t1.45',
    ].join('\n'), FIXTURE);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ prim: 'A', sec: 'B', parent: 'AB', spt1: 'G3IV', vmag2: 7.56 });
  });

  it('reads orbits', () => {
    const [r] = parseMscOrbits([
      'wds_id\tsyst\tper\tper_unit\tt0\te\ta_arcsec\tnode_deg\tlongp_deg\tincl_deg\tk1_kms\tk2_kms\tv0_kms\tnode_flag\tnote',
      '23300+5833\tAa,Ab\t6.0663\td\t40087.1914\t0.25\t\t\t31.4\t\t56.7\t\t-13.4\tB\tSB9_1445',
    ].join('\n'), FIXTURE);
    expect(r).toMatchObject({ syst: 'Aa,Ab', per: 6.0663, perUnit: 'd', aArcsec: null, longpDeg: 31.4 });
  });
});

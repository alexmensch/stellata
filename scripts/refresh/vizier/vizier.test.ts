import { describe, expect, it } from 'vitest';

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { assertTablesFit, batchQueries, describePull, type Pull } from '../pull/pull';
import { recordedTableCases } from '../pull/recorded-reply';
import { VIZIER } from '../pull/tap-pure';
import { CLASSIC_IDS_PULL, GLIESE_PULL, HIP2_PULL, HIP_VMAG_PULL, MSC_PULL } from './vizier';
import {
  BSC5, CNS5, CROSS_INDEX, GLIESE, HIP2, HIP_MAIN_VMAG, MSC_COMPONENTS, MSC_ORBITS, MSC_SYSTEMS, TYC2_HD,
} from './vizier-pure';

/** Synthetic, not recorded: committed rows written in the CSV dialect ESA, ARI and SIMBAD-Harvard answer with (README.md#replies). */
const REPLIES = {
  tyc2Hd: ['1,13,1,225210,1,1', '1,17,2,224725,1,1', '3105,2070,1,172167,1,1', '5949,2777,1,48915,1,1'],
  crossIndex: ['28,3,443,,33,Psc', '172167,7001,91262,alf,3,Lyr', '48915,2491,32349,alf,9,CMa'],
  bsc5: ['1,3,', '3,28,33    Psc', '7001,172167,3Alp Lyr', '2491,48915,9Alp CMa'],
  cns5: [
    '0,Sun,,,,,,,-,,,,,,,,-',
    '1,10001,,,,0.05633803966,25.90551781631,2015.5,2018A&A...616A...1G,70.8,1.9,2012ApJS..201...19D,-19.1,1.5,126.7,1.3,2012ApJS..201...19D',
    '3591,551,C,5853498713190525696,70890,217.39232147201,-62.67607511677,2016.0,2020yCat.1350....0G,768.07,0.06,'
      + '2020yCat.1350....0G,-3781.74,0.031,769.47,0.051,2020yCat.1350....0G',
  ],
  hipMainVmag: ['1,9.1,0.482,224700', '32349,-1.44,0.009,48915', '71683,-0.01,0.71,128620', '91262,0.03,-0.001,172167'],
  hip2: [
    '1,0.00091185,1.08901332,4.55,1.33,-4.55,-1.19,1.25,0.75,0.91,90',
    '32349,101.28854105,-16.71314306,379.21,1.58,-546.01,-1223.07,1.33,1.24,0.0,47',
  ],
  gliese: [
    'GJ 1002,,13.75,,,1.98,,,M5-5.5,,212.8,3.3,,212.8,-42.0,,,1.0541666666666665,-7.791666666666665,2.041,203.6,,G158-027,2,',
    'Gl 699,,9.55,,,1.74,,,M5 V,,545.3,1.0,,545.3,-111.0,,,268.8458333333333,4.555,10.31,355.8,BD+04  3561a,G140-024,57,V799',
    'NN 3417,,13.65,,,,,,m,,129.0,20.0,r,,,,,103.32083333333333,62.39499999999999,0.516,139.9,,G250-031,1885,',
  ],
  systems: [
    '00003-4417,AB,C,*,Cmp,107.0695,k,40.443,"""",318.2,17.68,,19.89,,3.15,0.13',
    '00022+2705,A,B,*,"V,S",26.28,y,0.83,"""",339.0,5.83,G5V,8.9,,0.94,0.64',
  ],
  orbits: [
    '00012+0905,"Aa,Ab",765.9424,d,327.604,0.455,,,15.16,,5.85,,-19.67,,NSS SB1',
    '23300+5833,"Aa,Ab",6.0663,d,40087.1914,0.25,,,31.4,,56.7,,-13.4,B,SB9_1445 1971PDDO....3...99G',
  ],
  components: ['23300+5833,A,B3IV,4.91,,,115990,221253,4.89', '23300+5833,D,,9.8,,1.3,,,4.65'],
};

const TABLES = [
  { name: 'tyc2Hd', file: DATA_FILES.tyc2Hd, table: TYC2_HD },
  { name: 'crossIndex', file: DATA_FILES.crossIndex, table: CROSS_INDEX },
  { name: 'bsc5', file: DATA_FILES.bsc5, table: BSC5 },
  { name: 'cns5', file: DATA_FILES.cns5, table: CNS5 },
  { name: 'hipMainVmag', file: DATA_FILES.hipMainVmag, table: HIP_MAIN_VMAG },
  { name: 'hip2', file: DATA_FILES.hip2, table: HIP2 },
  { name: 'gliese', file: DATA_FILES.gliese, table: GLIESE },
  { name: 'systems', file: DATA_FILES.mscSystems, table: MSC_SYSTEMS },
  { name: 'orbits', file: DATA_FILES.mscOrbits, table: MSC_ORBITS },
  { name: 'components', file: DATA_FILES.mscComponents, table: MSC_COMPONENTS },
] as const;

describe.each(TABLES)('$name', ({ name, file, table }) => {
  recordedTableCases(name, file, table, REPLIES[name]);
});

const PULLS: readonly Pull<string>[] = [CLASSIC_IDS_PULL, HIP_VMAG_PULL, GLIESE_PULL, HIP2_PULL, MSC_PULL];

describe('the pulls', () => {
  it('ask each table in one quoted query to CDS, and as the same whole table of CfA\'s ASU', () => {
    for (const pull of PULLS) {
      for (const table of Object.values(pull.tables)) {
        const queries = batchQueries(table, VIZIER.quote);
        expect(queries).toHaveLength(1);
        expect(queries[0]).toMatch(/ FROM "[^"]+"$/);
      }
      expect(describePull(pull).services).toEqual(['CDS', 'CfA']);
    }
    for (const { table } of TABLES) {
      const asu = table.scope.kind === 'whole-table' ? table.scope.asu : undefined;
      expect(asu?.source).toBe(table.vizierId);
      expect(asu?.columns.map((c) => c.name)).toEqual(table.columns.map((c) => c.name));
      expect(asu?.constraints).toEqual({});
    }
  });

  it('order each table totally: its keys, then every other column as text', () => {
    expect(TYC2_HD.sortBy.map((k) => `${k.column}:${k.as}`)).toEqual([
      'tyc1:integer', 'tyc2:integer', 'tyc3:integer', 'hd:text', 'n_hd:text', 'n_tyc:text',
    ]);
    for (const { table } of TABLES) expect(new Set(table.sortBy.map((k) => k.column))).toEqual(new Set(table.columns.map((c) => c.name)));
  });

  it('hold every row within the table cell cap', () => {
    for (const pull of PULLS) expect(() => assertTablesFit(pull)).not.toThrow();
  });
});

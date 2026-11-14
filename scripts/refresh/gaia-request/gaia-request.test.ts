import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { REPO_ROOT, lfsContentReadable } from '../../util/paths';
import { queryLimit } from '../pull/pull';
import { committedRows, recordedTableCases } from '../pull/recorded-reply';
import {
  ASTROMETRY_SPOTS, DR2_ROWS_PER_ID, astrometryTable, dr2NeighbourhoodTable, gspcTable,
} from './gaia-request-pure';

/** Replies recorded from ESA on 2026-11-08 for each table's spot rows; ARI answered the same text except the boolean, written 1/0. */
const ASTROMETRY_REPLY = [
  '3723554268436602240,210.631835043388,0.02491643,9.685782710160318,0.022913245,3.0990571246135055,0.033200946,-189.53863096414872,0.031019628,-70.41503812159836,0.025030838,2016.0,1.0245681,0,5.87496,6.3974733,5.178669,-26.128664,0.11880184',
  '7632157690368,45.034342834696204,0.03077455,0.23538959951604121,0.023234252,5.60229354383997,0.031825747,45.4660098305345,0.04021206,-6.834343096515991,0.029077915,2016.0,1.3809834,0,8.068802,8.554075,7.4199953,5.901028,0.27284372',
  '594595272471808,46.34772438846418,0.03518862,1.6357914346095994,0.02999693,11.029723548961819,0.040406622,49.415685006072984,0.043331034,-45.94192227187228,0.036030304,2016.0,2.6804588,0,11.953011,12.721654,11.093768,7.3482985,0.6237778',
  '4472832130942575872,269.44850252543836,0.026238997,4.739420051112412,0.029043527,546.975939730948,0.040116355,-801.5509783684709,0.031820867,10362.394206546573,0.036070455,2016.0,1.0848505,0,8.1939745,9.791788,6.9580913,-110.46822,0.13125522',
  '4923860051276772608,0.18555746500007905,0.0064453436,-54.83083281791827,0.006732112,16.164144500365733,0.00932246,-202.7111034469219,0.008062241,-71.6125435702873,0.008971466,2016.0,0.9061898,0,10.588468,11.212916,9.835994,21.18429,0.20528927',
  '594599568167552,46.34790554492768,0.15961675,1.6353693937702984,0.16575596,10.491703175442018,0.18460374,44.048527237771225,0.24517998,-53.99990757405283,0.23253892,2016.0,0.9749684,1,17.316568,,,,',
  '4040814466068502656,268.26935637201575,0.04159869,-34.76115485446878,0.03327472,3.491053586328345,0.045627993,2.675863237154372,0.04859462,-5.678956016980035,0.032416336,2016.0,1.369661,0,8.888946,8.972153,8.711436,,',
];

const GSPC_REPLY = [
  '4472832130942575872,11.249152,2.0508753E-15,1.6823492E-17,0,9.555117,5.540044E-15,2.7624626E-17,0',
  '10625474212633728,,,,0,11.702773,7.6639165E-16,1.3610774E-17,1',
  '7632157690368,9.264618,1.275713E-14,6.512287E-17,0,8.328837,1.7140567E-14,4.2354734E-17,0',
  '36747057287093632,11.890008,1.136572E-15,3.691754E-18,1,11.224282,1.1908231E-15,2.7293763E-18,1',
];

const DR2_REPLY_ESA = [
  '3017253180145915136,3017253184443743616,357.02704,-0.044504166,false',
  '9178383766474496,9178383766474496,0.2653519,-0.016911507,true',
  '3017253180145915136,3017253180145915136,22.072561,0.24598503,true',
  '594599568167552,594599568167552,0.5924902,0.30194855,true',
  '594595272471808,594599568167552,1650.6844,5.353774,true',
];

const DR2_REPLY_ARI = DR2_REPLY_ESA.map((line) => line.replace(/true$/, '1').replace(/false$/, '0'));

const NO_IDS: readonly bigint[] = [];

const TABLES = [
  { name: 'astrometry', table: astrometryTable(NO_IDS, ASTROMETRY_SPOTS), file: DATA_FILES.gaiaAstrometry, reply: ASTROMETRY_REPLY },
  { name: 'gspc', table: gspcTable(NO_IDS), file: DATA_FILES.gaiaGspc, reply: GSPC_REPLY },
  { name: 'dr2 neighbourhood (ESA)', table: dr2NeighbourhoodTable(NO_IDS), file: DATA_FILES.gaiaDr2Neighbourhood, reply: DR2_REPLY_ESA },
  { name: 'dr2 neighbourhood (ARI)', table: dr2NeighbourhoodTable(NO_IDS), file: DATA_FILES.gaiaDr2Neighbourhood, reply: DR2_REPLY_ARI },
] as const;

describe.each(TABLES)('$name', ({ name, table, file, reply }) => recordedTableCases(name, file, table, reply));

describe('the request queries', () => {
  it('ask at most 20,000 rows each, so ESA\'s 50,000-row hard limit holds every batch', () => {
    expect(TABLES.map(({ table }) => queryLimit(table))).toEqual([10_000, 10_000, 20_000, 20_000]);
  });

  it.skipIf(!lfsContentReadable(join(REPO_ROOT, DATA_FILES.gaiaDr2Neighbourhood)))(
    'hold every DR3 id\'s rows in the committed neighbourhood within DR2_ROWS_PER_ID',
    () => {
      const { lines } = committedRows(DATA_FILES.gaiaDr2Neighbourhood);
      const perId = new Map<string, number>();
      for (const line of lines) {
        const dr3 = line.split('\t')[1];
        perId.set(dr3, (perId.get(dr3) ?? 0) + 1);
      }
      expect(Math.max(...perId.values())).toBe(DR2_ROWS_PER_ID);
    },
  );
});

describe('the astrometry schema', () => {
  it('carries the 0.95 coverage floor in its band: at least ceil(0.95 n) rows, at most n', () => {
    const ids = Array.from({ length: 383_059 }, (_, i) => BigInt(i + 1));
    expect(astrometryTable(ids, ASTROMETRY_SPOTS).band).toEqual({ min: 363_907, max: 383_059 });
  });
});

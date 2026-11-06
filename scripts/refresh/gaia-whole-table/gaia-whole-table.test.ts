import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { REPO_ROOT } from '../../util/paths';
import { cellReader, checkedRows, formatTsv, sortRows } from '../pull/columns-pure';
import { spotRowCheck } from '../pull/gates-pure';
import { batchQueries, queryLimit, type PullTable } from '../pull/pull';
import { cutEdges, sliceCounts } from '../pull/slices-pure';
import { GAIA, readCsv } from '../pull/tap-pure';
import { GAIA_SLICE_ROWS, HIP_XMATCH, NSS_TWO_BODY, TYC_XMATCH } from './gaia-whole-table-pure';

const replyHeader = (table: PullTable): string => table.columns.map((c) => c.name).join(',');

/** Replies recorded from ESA on 2026-11-06: the spot rows plus the hard cases the README names. */
const REPLIES = {
  hip: [
    '38430,5602025904044961536,0.0055622146,1,8',
    '8102,2452378776434477184,0.0075398358,1,8',
    '46144,1040043514891491968,8.440302E-4,1,8',
    '2,2341871673090078592,0.04382643,1,8',
    '3,2881742980523997824,0.0016044503,1,8',
  ],
  tyc: [
    '2908-290-1,202306742196859648,0.1570405,1,8',
    '2726-2257-1,1948934357952258304,0.16092865,1,8',
    '1000-12-1,4493551435421183360,0.33196032,1,8',
    '4352-1171-1,486100417131058048,0.019045461,1,8',
    '6455-874-1,5083243951169606016,0.046136,1,8',
    '2893-1482-1,199637162322750336,1.0490755,1,16',
    '2393-1410-1,181738139518381824,0.1410765,1,8',
  ],
  nss: [
    '5823248090239625088,OrbitalTargetedSearch,488.4291679390102,3.1467,11.430366554337581,52.44574,0.1495367617275547,0.043536834,'
      + '0.11556221913471246,0.42908052,-0.17102784494711115,0.7109712,1.2353209871073731,0.07389782,2.1120883476810928,0.06517179,'
      + ',,,,,,,,,,1.4451202,36.06349',
    '33711199137024,Orbital,773.0921101652751,27.351328,143.01267303924104,35.11744,0.3274445911851798,0.098035514,'
      + '-0.8305162402672168,0.13799927,-0.6875868770647713,0.19882414,0.45371707337300843,0.25382182,-0.9858676354099775,0.286759,'
      + ',,,,,,,,,,0.8528669,6.981612',
    '4648984790038560256,SB1,524.0654050701588,7.3522487,89.8681259923026,53.676945,0.08154041909126154,0.049620762,'
      + ',,,,,,,,,,,,,,202.65396589295548,37.26105,,,-0.04594423,17.899855',
    '6360853029303982592,Orbital,466.2104463609643,0.7293173,-143.47613441634357,2.3760302,0.7917730371002119,0.037649486,'
      + '-4.639335582468894,0.11858249,-0.08086474698096051,0.025754647,3.524529362911686,0.49702537,1.1595702397837646,0.11008447,'
      + ',,,,,,,,,,6.091029,14.677704',
    '138577120584320,EclipsingBinary,0.385854572057724,,0.1390818953514099,9.045827E-5,0.0,,,,,,,,,,,,,,66.64820727941904,0.1248893,0.0,,,,18.19693,0.0',
    '2747576478880512,Orbital,227.31967370212286,2.8379035,-13.368635977247948,27.471853,0.2483719980794645,0.12195197,'
      + '0.024504066398540757,0.56414735,-0.3610163385647766,0.10647808,0.880535290150256,0.034179732,-0.1741942859021553,0.18594255,'
      + ',,,,,,,,,,6.420549,23.53201',
    '2747576478880512,SB1,0.6214878186210907,2.0509997E-5,0.20049215971450943,0.0992019,0.0766246658597285,0.08542621,'
      + ',,,,,,,,,,,,,,252.79000223673825,57.788853,,,-0.60351914,13.752674',
  ],
};

const PULLS = [
  { name: 'hip-xmatch', table: HIP_XMATCH, file: DATA_FILES.gaiaHipXmatch, key: 'gaia_source_id', reply: REPLIES.hip },
  { name: 'tyc-xmatch', table: TYC_XMATCH, file: DATA_FILES.gaiaTycXmatch, key: 'gaia_source_id', reply: REPLIES.tyc },
  { name: 'nss', table: NSS_TWO_BODY, file: DATA_FILES.gaiaNssTwoBody, key: 'source_id', reply: REPLIES.nss },
] as const;

const committed = (file: string): string => readFileSync(join(REPO_ROOT, file), 'utf8');

function sliced(table: PullTable) {
  if (table.scope.kind !== 'sliced') throw new Error('not a sliced table');
  return table.scope;
}

describe.each(PULLS)('$name', ({ name, table, file, key, reply }) => {
  it('writes a recorded reply\'s rows as the committed table\'s lines, and its spot rows match', () => {
    const csv = `${[replyHeader(table), ...reply].join('\n')}\n`;
    const rows = checkedRows(table.columns, readCsv(csv, queryLimit(table), name), name);
    const [header, ...lines] = formatTsv(file, table.columns, sortRows(table.columns, rows, table.sortBy, name)).trimEnd().split('\n');
    const text = committed(file);
    expect(text.slice(0, text.indexOf('\n'))).toBe(header);
    expect(lines.filter((line) => !text.includes(`\n${line}\n`))).toEqual([]);
    expect(spotRowCheck(name, rows.map(cellReader(table.columns, name)), table.spotRows).kind).toBe('pass');
  });

  it('holds every slice of the committed table within GAIA_SLICE_ROWS', () => {
    const lines = committed(file).trimEnd().split('\n');
    const at = lines[0].split('\t').indexOf(key);
    const keys = lines.slice(1).map((line) => BigInt(line.split('\t')[at]));
    const { edges } = sliced(table);
    const over = sliceCounts(keys, edges).filter((n) => n > GAIA_SLICE_ROWS);
    const recut = (): string => cutEdges(keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), GAIA_SLICE_ROWS).join(', ');
    expect(over, over.length === 0 ? '' : `re-cut the edges: ${recut()}`).toEqual([]);
  });
});

describe('the sliced queries', () => {
  it('ask at most 48,000 rows each, so ESA\'s 50,000-row hard limit holds every slice', () => {
    expect(PULLS.map(({ table }) => queryLimit(table))).toEqual([48_000, 48_000, 48_000]);
  });

  it('cut HIP into 5 slices, TYC into 105 and NSS into 19', () => {
    expect(PULLS.map(({ table }) => batchQueries(table, GAIA.quote).length)).toEqual([5, 105, 19]);
  });
});

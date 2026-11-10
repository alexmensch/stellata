import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { REPO_ROOT, lfsContentReadable } from '../../util/paths';
import { cellReader } from '../pull/columns-pure';
import { spotRowCheck } from '../pull/gates-pure';
import { assertTablesFit, batchQueries, queryLimit } from '../pull/pull';
import { linesNotCommitted, oversizedSlices, replyRows } from '../pull/recorded-reply';
import { GAIA, GAIA_SLICE_ROWS } from '../pull/tap-pure';
import { HIP_XMATCH_PULL, TYC_XMATCH_PULL } from './gaia-whole-table';
import { HIP_XMATCH, TYC_XMATCH } from './gaia-whole-table-pure';
import { HIP_XMATCH_EDGES, TYC_XMATCH_EDGES } from './slice-edges';

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
};

const PULLS = [
  { name: 'hip-xmatch', table: HIP_XMATCH, edges: HIP_XMATCH_EDGES, file: DATA_FILES.gaiaHipXmatch, reply: REPLIES.hip },
  { name: 'tyc-xmatch', table: TYC_XMATCH, edges: TYC_XMATCH_EDGES, file: DATA_FILES.gaiaTycXmatch, reply: REPLIES.tyc },
] as const;

const SLICE_KEY = 'gaia_source_id';

describe.each(PULLS)('$name', ({ name, table, edges, file, reply }) => {
  const readable = lfsContentReadable(join(REPO_ROOT, file));

  it.skipIf(!readable)('writes a recorded reply\'s rows as the committed table\'s lines, and its spot rows match', () => {
    const rows = replyRows(name, table.columns, reply);
    expect(linesNotCommitted(file, table.columns, rows)).toEqual([]);
    expect(spotRowCheck(name, rows.map(cellReader(table.columns, name)), table.spotRows).kind).toBe('pass');
  });

  it.skipIf(!readable)('holds every slice of the committed table within GAIA_SLICE_ROWS', () => {
    const { over, recut } = oversizedSlices(file, SLICE_KEY, edges, GAIA_SLICE_ROWS, BigInt);
    expect(over, over.length === 0 ? '' : `re-cut the edges: ${recut().join(', ')}`).toEqual([]);
  });
});

describe('the sliced queries', () => {
  it('ask at most 48,000 rows each, so ESA\'s 50,000-row hard limit holds every slice', () => {
    expect(PULLS.map(({ table }) => queryLimit(table))).toEqual([48_000, 48_000]);
  });

  it('hold every row within the table cell cap', () => {
    for (const pull of [HIP_XMATCH_PULL, TYC_XMATCH_PULL]) expect(() => assertTablesFit(pull)).not.toThrow();
  });

  it('cut HIP into 5 slices and TYC into 105', () => {
    expect(PULLS.map(({ table }) => batchQueries(table, GAIA.quote).length)).toEqual([5, 105]);
  });
});

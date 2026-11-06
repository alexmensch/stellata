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

const PULLS = [
  { name: 'hip-xmatch', table: HIP_XMATCH, file: DATA_FILES.gaiaHipXmatch, key: 'gaia_source_id' },
  { name: 'tyc-xmatch', table: TYC_XMATCH, file: DATA_FILES.gaiaTycXmatch, key: 'gaia_source_id' },
  { name: 'nss', table: NSS_TWO_BODY, file: DATA_FILES.gaiaNssTwoBody, key: 'source_id' },
] as const;

const committed = (file: string): string => readFileSync(join(REPO_ROOT, file), 'utf8');
const fixture = (name: string): string => readFileSync(join(__dirname, `${name}.fixture.csv`), 'utf8');

function sliced(table: PullTable) {
  if (table.scope.kind !== 'sliced') throw new Error('not a sliced table');
  return table.scope;
}

describe.each(PULLS)('$name', ({ name, table, file, key }) => {
  it('writes a recorded reply\'s rows as the committed table\'s lines, and its spot rows match', () => {
    const rows = checkedRows(table.columns, readCsv(fixture(name), queryLimit(table), name), name);
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

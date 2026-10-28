import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../../util/paths';
import { readTable } from '../../util/tsv/table-pure';
import { MULTIPLES_COLUMNS, MULTIPLES_TSV } from '../multiples-tsv';
import { FIXTURE_SYSTEMS, cutMultiples, cutRowIndexMap, wdsIdOf } from './cut-fixture-pure';

const DEFAULTS: Record<string, string> = {
  source: 'wds', regime: '0', resolve_via: 'unresolved', astrometry_via: 'gaia_5p', orbit_via: 'none',
  spect_via: 'none', photometry_via: 'none', a_via: 'none', orbit_role: 'primary',
};
const line = (cells: Record<string, string>): string =>
  MULTIPLES_COLUMNS.map((c) => cells[c] ?? DEFAULTS[c] ?? '').join('\t');
const RECORDS = MULTIPLES_TSV.parse([
  MULTIPLES_COLUMNS.join('\t'),
  line({ system_id: '00001+0001-AB', comp: 'A', hip: '10', gaia_source_id: '100' }),
  line({ system_id: '00001+0001-AB', comp: 'B', gaia_source_id: '101' }),
  line({ system_id: '00001+0001-_C', comp: 'C', hip: '12', orbit_role: 'standalone' }),
  line({ system_id: '00002-0002-AB', comp: 'A', hip: '20', gaia_source_id: '200' }),
  '',
].join('\n'));

describe('cutMultiples', () => {
  it('keeps every row of the named systems, standalone rows included', () => {
    expect(cutMultiples(RECORDS, ['00001+0001']).map((r) => `${r.systemId} ${r.comp}`))
      .toEqual(['00001+0001-AB A', '00001+0001-AB B', '00001+0001-_C C']);
  });
});

describe('cutRowIndexMap', () => {
  it('keeps the ids the cut rows carry and the synth keys of the named systems', () => {
    const map = {
      byGaia: { 100: 1, 101: 2, 200: 3 },
      byHip: { 10: 4, 12: 5, 20: 6 },
      bySynth: { 'synth-00001+0001-B': 7, 'synth-00002-0002-B': 8 },
    };
    const cut = cutMultiples(RECORDS, ['00001+0001']);
    expect(cutRowIndexMap(map, cut, ['00001+0001'])).toEqual({
      byGaia: { 100: 1, 101: 2 },
      byHip: { 10: 4, 12: 5 },
      bySynth: { 'synth-00001+0001-B': 7 },
    });
  });
});

describe('committed fixture', () => {
  it('holds exactly the FIXTURE_SYSTEMS', () => {
    const tsv = readFileSync(resolve(REPO_ROOT, 'scripts/binaries/golden/fixture-multiples.tsv'), 'utf8');
    const fixture = { file: 'scripts/binaries/golden/fixture-multiples.tsv', columns: ['system_id'] as const, hint: 'Re-cut it.' };
    const systems = new Set([...readTable(fixture, tsv)].map((r) => wdsIdOf(r.raw('system_id'))));
    expect([...systems].sort()).toEqual([...FIXTURE_SYSTEMS].sort());
  });
});

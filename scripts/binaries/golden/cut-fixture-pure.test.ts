import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../../util/paths';
import { FIXTURE_SYSTEMS, cutMultiples, cutRowIndexMap, wdsIdOf } from './cut-fixture-pure';

const TSV = [
  'system_id\tcomp\thip\tgaia_source_id',
  '00001+0001-AB\tA\t10\t100',
  '00001+0001-AB\tB\t\t101',
  '00001+0001-_C\tC\t12\t',
  '00002-0002-AB\tA\t20\t200',
  '',
].join('\n');

describe('cutMultiples', () => {
  it('keeps the header and every row of the named systems, standalone rows included', () => {
    expect(cutMultiples(TSV, ['00001+0001'])).toBe([
      'system_id\tcomp\thip\tgaia_source_id',
      '00001+0001-AB\tA\t10\t100',
      '00001+0001-AB\tB\t\t101',
      '00001+0001-_C\tC\t12\t',
      '',
    ].join('\n'));
  });
});

describe('cutRowIndexMap', () => {
  it('keeps the ids the cut rows carry and the synth keys of the named systems', () => {
    const map = {
      byGaia: { 100: 1, 101: 2, 200: 3 },
      byHip: { 10: 4, 12: 5, 20: 6 },
      bySynth: { 'synth-00001+0001-B': 7, 'synth-00002-0002-B': 8 },
    };
    const cut = cutMultiples(TSV, ['00001+0001']);
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
    const systems = new Set(
      tsv.split('\n').slice(1).filter((l) => l !== '')
        .map((l) => wdsIdOf(l.split('\t', 1)[0])),
    );
    expect([...systems].sort()).toEqual([...FIXTURE_SYSTEMS].sort());
  });
});

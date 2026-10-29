import { describe, expect, it } from 'vitest';

import { diffLineage, stageDiffText } from './lineage-diff-pure';
import { judgeBaseline, type StageHeader } from './lineage-header-pure';
import {
  compareLineageRows, compareUtf8, lineageRows, paramsOf, paramsText, stageLineageText,
  type LineageRow,
} from './lineage-row-pure';
import { LIVE, stageCodes } from './reason-codes-pure';

const CODES = stageCodes('demo', {
  kept: { description: 'kept', effect: 'none', status: LIVE },
  'gate.refused': { description: 'refused by the gate', effect: 'none', status: LIVE },
});

function row(key: string, code = 'demo.kept', params: Record<string, string> = {}): LineageRow {
  return { stage: 'demo', key, role: 'outcome', code, params: paramsText(params), evidence: [] };
}

describe('the lineage order', () => {
  it('sorts Gaia ids above 2^53 by bytes, never numerically, the same in writer and diff', () => {
    const mixed = [
      row('spine:10'), row('gaia-dr3:9'), row('multiples:00057+4549/B'),
      row('gaia-dr3:4295806720123456789'), row('spine:2'), row('gaia-dr3:18014398509481985'),
    ];
    const keys = (rows: readonly LineageRow[]): string[] => rows.map((r) => r.key);
    const written = [...lineageRows(stageLineageText(CODES, mixed), 'fixture/demo.tsv')];
    expect(keys(written)).toEqual([
      'gaia-dr3:18014398509481985', 'gaia-dr3:4295806720123456789', 'gaia-dr3:9',
      'multiples:00057+4549/B', 'spine:10', 'spine:2',
    ]);
    expect(keys([...mixed].sort(compareLineageRows))).toEqual(keys(written));
    expect(diffLineage(written, written)).toEqual([]);
  });

  it('orders by code point, so an astral character sorts after U+FFFD', () => {
    expect(compareUtf8('\u{1F600}', '�')).toBe(1);
    expect(compareUtf8('a', 'ab')).toBe(-1);
    expect(compareUtf8('b', 'a')).toBe(1);
  });

  it('round-trips params through their canonical text', () => {
    const r = row('spine:2', 'demo.kept', { source: '42', via: 'tyc' });
    expect(paramsOf([...lineageRows(stageLineageText(CODES, [r]), 'fixture/demo.tsv')][0]))
      .toEqual({ source: '42', via: 'tyc' });
  });
});

describe('the writer', () => {
  it('refuses a code the stage does not declare, and another stage\'s row', () => {
    expect(() => stageLineageText(CODES, [row('spine:2', 'demo.unrecorded')]))
      .toThrow(/demo.unrecorded is not a declared demo code/);
    expect(() => stageLineageText(CODES, [{ ...row('spine:2'), stage: 'other' }]))
      .toThrow(/a row of stage other in the demo file/);
  });

  it('refuses an undeclarable code name', () => {
    expect(() => stageCodes('demo', { 'Bad Name': { description: 'x', effect: 'none', status: LIVE } }))
      .toThrow(/not lowercase dotted words/);
  });
});

describe('diffLineage', () => {
  it('reports added, removed and changed keys, a changed key by its differing rows only', () => {
    const before = [row('spine:2'), row('spine:3'), row('spine:4', 'demo.kept', { source: '1' })]
      .sort(compareLineageRows);
    const after = [
      row('spine:3'), row('spine:4', 'demo.kept', { source: '2' }), row('spine:5'),
    ].sort(compareLineageRows);
    const changes = diffLineage(before, after);
    expect(changes.map((c) => [c.kind, c.key])).toEqual([
      ['removed', 'spine:2'], ['changed', 'spine:4'], ['added', 'spine:5'],
    ]);
    expect(changes[1].removed.map(paramsOf)).toEqual([{ source: '1' }]);
    expect(changes[1].added.map(paramsOf)).toEqual([{ source: '2' }]);
    expect(stageDiffText(changes, [{ name: 'note', of: (k) => `n:${k}` }]).split('\n')[2])
      .toBe('changed\t-\tdemo\tspine:4\toutcome\tdemo.kept\t{"source":"1"}\t\tn:spine:4');
  });

  it('refuses an input out of lineage order', () => {
    expect(() => diffLineage([row('spine:3'), row('spine:2')], [])).toThrow(/not in lineage order/);
  });
});

describe('judgeBaseline', () => {
  const header = (commit: string): StageHeader => ({
    stage: 'demo', version: '1.0.0', commit, inputHash: 'h', files: ['demo.tsv.gz'],
  });

  it('diffs a baseline built at the merge-base, and nothing when there is none', () => {
    expect(judgeBaseline({ kind: 'checkout', header: header('abc') }, 'abc', false))
      .toEqual({ kind: 'diff', why: 'merge-base' });
    expect(judgeBaseline({ kind: 'absent' }, 'abc', false)).toEqual({ kind: 'none' });
  });

  it('refuses any other baseline, naming its commit, unless told to accept it', () => {
    const refused = judgeBaseline({ kind: 'checkout', header: header('old') }, 'abc', false);
    expect(refused.kind).toBe('refused');
    expect(refused.kind === 'refused' && refused.message).toMatch(/built at old, not the merge-base abc/);
    expect(judgeBaseline({ kind: 'checkout', header: header('old') }, 'abc', true))
      .toEqual({ kind: 'diff', why: 'accepted' });
    expect(judgeBaseline({ kind: 'against', dir: '/elsewhere' }, null, false))
      .toEqual({ kind: 'diff', why: 'against' });
  });
});

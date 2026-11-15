import { describe, expect, it } from 'vitest';

import {
  invariantCheck, invariantViolations, lineageInvariant, namedExceptionsInvariant, namedRow, namedRowsInvariant, NO_EXCEPTIONS, VIOLATIONS_LISTED,
} from './lineage-invariant-pure';
import { paramsText, stageLineageLine, type LineageLine } from './lineage-row-pure';
import { outcomeCode, stageCodes } from './reason-codes/reason-codes-pure';

const CODES = stageCodes('demo', {
  ok: outcomeCode('Fine.'),
  gap: outcomeCode('A gap.'),
});

const line = (key: string, branch: 'ok' | 'gap', params: Record<string, string> = {}): LineageLine =>
  stageLineageLine(CODES, {
    stage: 'demo', key, role: 'outcome', code: CODES.code(branch), params: paramsText(params), evidence: [],
  });

describe('invariantViolations', () => {
  it('names only the watched code\'s rows its exceptions do not allow', () => {
    const inv = lineageInvariant(CODES, 'gap', 'no gap but a reviewed one', (p) => p.why === 'reviewed');
    const [v] = invariantViolations([inv], [
      line('a:1', 'ok'), line('a:2', 'gap', { why: 'reviewed' }), line('a:3', 'gap', { why: 'new' }),
    ]);
    expect(v.rows.map((r) => r.key)).toEqual(['a:3']);
  });

  it('asks each invariant once per distinct params text, and still names every row it does not allow', () => {
    const asked: string[] = [];
    const inv = lineageInvariant(CODES, 'gap', 'no gap but a reviewed one', (p) => {
      asked.push(p.why ?? '');
      return p.why === 'reviewed';
    });
    const [v] = invariantViolations([inv], [
      line('a:1', 'gap', { why: 'new' }), line('a:2', 'gap', { why: 'reviewed' }), line('a:3', 'gap', { why: 'new' }),
      line('a:4', 'gap'), line('a:5', 'gap', { why: 'reviewed' }),
    ]);
    expect(asked).toEqual(['new', 'reviewed', '']);
    expect(v.rows.map((r) => r.key)).toEqual(['a:1', 'a:3', 'a:4']);
  });

  it('passes, reporting what holds, when no row breaks it', () => {
    const inv = lineageInvariant(CODES, 'gap', 'no gap', NO_EXCEPTIONS);
    expect(invariantCheck(invariantViolations([inv], [line('a:1', 'ok')])[0]))
      .toEqual({ kind: 'pass', report: 'invariant holds: no gap' });
  });

  it('fails listing the first rows and counting the rest', () => {
    const inv = lineageInvariant(CODES, 'gap', 'no gap', NO_EXCEPTIONS);
    const lines = Array.from({ length: VIOLATIONS_LISTED + 3 }, (_, i) => line(`a:${i}`, 'gap'));
    const check = invariantCheck(invariantViolations([inv], lines)[0]);
    if (check.kind !== 'fail') throw new Error('expected a failed check');
    expect(check.message.split('\n')[0]).toBe(`invariant broken by ${VIOLATIONS_LISTED + 3} demo.gap rows: no gap`);
    expect(check.message).toContain('a:0\tdemo.gap');
    expect(check.message).toContain('… and 3 more');
  });
});

describe('named exceptions', () => {
  const named = new Map([['a:1', 'the first reviewed row'], ['a:2', 'the second reviewed row']]);
  const inv = namedExceptionsInvariant(CODES, 'gap', 'no gap but a reviewed row', named);

  it('passes when the code\'s rows are exactly the named rows', () => {
    const [v] = invariantViolations([inv], [line('a:1', 'gap'), line('a:2', 'gap'), line('a:3', 'ok')]);
    expect(v.rows).toEqual([]);
    expect(v.stale).toEqual([]);
    expect(invariantCheck(v)).toEqual({ kind: 'pass', report: 'invariant holds: no gap but a reviewed row' });
  });

  it('names every unlisted row, whatever its params share with a listed one', () => {
    const [v] = invariantViolations([inv], [
      line('a:1', 'gap', { record: 'r:1' }), line('a:2', 'gap'), line('a:3', 'gap', { record: 'r:1' }), line('a:4', 'gap'),
    ]);
    expect(v.rows.map((r) => r.key)).toEqual(['a:3', 'a:4']);
  });

  it('fails naming each listed row no line carries any more', () => {
    const [v] = invariantViolations([inv], [line('a:1', 'gap')]);
    expect(v.rows).toEqual([]);
    expect(v.stale).toEqual([{ name: 'a:2', what: 'the second reviewed row' }]);
    const check = invariantCheck(v);
    if (check.kind !== 'fail') throw new Error('expected a failed check');
    expect(check.message).toBe(
      '1 declared demo.gap exceptions no row carries any more; delete them: no gap but a reviewed row\n'
      + '  a:2\tthe second reviewed row',
    );
  });

  it('reports broken rows and lapsed exceptions together', () => {
    const [v] = invariantViolations([inv], [line('a:1', 'gap'), line('b:9', 'gap')]);
    const check = invariantCheck(v);
    if (check.kind !== 'fail') throw new Error('expected a failed check');
    expect(check.message.split('\n').map((l) => l.split(':')[0])).toEqual([
      'invariant broken by 1 demo.gap rows', '  b', '1 declared demo.gap exceptions no row carries any more; delete them', '  a',
    ]);
  });

  it('named by key and params, a listed key with other params is a new row, and a listed pair it no longer carries is stale', () => {
    const byPair = namedRowsInvariant(CODES, 'gap', 'no gap but a reviewed pair', new Map([
      [namedRow('a:1', { other: 'a:2' }), 'the reviewed pair'],
      [namedRow('a:1', { other: 'a:3' }), 'the pair since fixed'],
    ]));
    const [v] = invariantViolations([byPair], [line('a:1', 'gap', { other: 'a:2' }), line('a:1', 'gap', { other: 'a:4' })]);
    expect(v.rows.map((r) => r.params)).toEqual([paramsText({ other: 'a:4' })]);
    expect(v.stale).toEqual([{ name: namedRow('a:1', { other: 'a:3' }), what: 'the pair since fixed' }]);
  });

  it('a rule-excepted invariant has nothing to go stale', () => {
    const rule = lineageInvariant(CODES, 'gap', 'no gap', NO_EXCEPTIONS);
    expect(invariantViolations([rule], [])[0].stale).toEqual([]);
  });
});

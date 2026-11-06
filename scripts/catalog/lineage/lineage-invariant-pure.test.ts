import { describe, expect, it } from 'vitest';

import {
  invariantCheck, invariantViolations, lineageInvariant, NO_EXCEPTIONS, VIOLATIONS_LISTED,
} from './lineage-invariant-pure';
import { paramsText, stageLineageLine, type LineageLine } from './lineage-row-pure';
import { LIVE, stageCodes } from './reason-codes-pure';

const CODES = stageCodes('demo', {
  ok: { description: 'Fine.', effect: 'none', status: LIVE },
  gap: { description: 'A gap.', effect: 'none', status: LIVE },
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

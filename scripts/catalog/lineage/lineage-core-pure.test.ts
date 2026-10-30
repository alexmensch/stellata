import { describe, expect, it } from 'vitest';

import { diffLineage, stageDiffText } from './lineage-diff-pure';
import { judgeBaseline, planBaseline, type StageHeader } from './lineage-header-pure';
import {
  compareUtf8, decodeLineageLine, encodeLineageLine, lineageLineKey, lineageLines, lineageRows, paramsOf,
  paramsText, sortLineageLines, stageLineageLine, stageLineageText, type LineageLine, type LineageRow,
} from './lineage-row-pure';
import { LIVE, stageCodes } from './reason-codes-pure';

const CODES = stageCodes('demo', {
  kept: { description: 'kept', effect: 'none', status: LIVE },
  'gate.refused': { description: 'refused by the gate', effect: 'none', status: LIVE },
});

function row(key: string, code = 'demo.kept', params: Record<string, string> = {}): LineageRow {
  return { stage: 'demo', key, role: 'outcome', code, params: paramsText(params), evidence: [] };
}

const line = (r: LineageRow): LineageLine => stageLineageLine(CODES, r);

describe('the lineage order', () => {
  it('sorts Gaia ids above 2^53 by bytes, never numerically, the same in writer and diff', () => {
    const mixed = [
      row('spine:10'), row('gaia-dr3:9'), row('multiples:00057+4549/B'),
      row('gaia-dr3:4295806720123456789'), row('spine:2'), row('gaia-dr3:18014398509481985'),
    ].map(line);
    const sorted = sortLineageLines(mixed);
    const written = [...lineageLines(stageLineageText(CODES, sorted), 'fixture/demo.tsv')];
    expect(written.map(lineageLineKey)).toEqual([
      'gaia-dr3:18014398509481985', 'gaia-dr3:4295806720123456789', 'gaia-dr3:9',
      'multiples:00057+4549/B', 'spine:10', 'spine:2',
    ]);
    expect(diffLineage(written, sorted)).toEqual([]);
    expect(diffLineage(written.values(), sorted)).toEqual([]);
  });

  it('sorts a key\'s lines by role, code, params, then evidence, a shorter cell first', () => {
    const lines = [
      { ...row('spine:1'), evidence: ['tyc:1-2'] }, row('spine:10'),
      { ...row('spine:1'), evidence: ['tyc:1', 'tyc:1-2'] }, row('spine:1', 'demo.kept', { source: 'a' }),
      row('spine:1', 'demo.gate.refused'), { ...row('spine:1'), role: 'refused' as const }, row('spine:1'),
    ].map(line);
    expect(sortLineageLines(lines).map(decodeLineageLine)).toEqual([
      row('spine:1', 'demo.gate.refused'), row('spine:1'), { ...row('spine:1'), evidence: ['tyc:1-2'] },
      { ...row('spine:1'), evidence: ['tyc:1', 'tyc:1-2'] }, row('spine:1', 'demo.kept', { source: 'a' }),
      { ...row('spine:1'), role: 'refused' }, row('spine:10'),
    ]);
  });

  it('the writer refuses lines out of lineage order, as the diff does', () => {
    const outOfOrder = [line(row('spine:3')), line(row('spine:2'))];
    expect(() => stageLineageText(CODES, outOfOrder)).toThrow(/demo file is not in lineage order at key spine:2/);
    expect(() => diffLineage(outOfOrder, [])).toThrow(/not in lineage order/);
  });

  it('orders by code point, so an astral character sorts after U+FFFD', () => {
    expect(compareUtf8('\u{1F600}', '�')).toBe(1);
    expect(compareUtf8('a', 'ab')).toBe(-1);
    expect(compareUtf8('b', 'a')).toBe(1);
    expect(sortLineageLines([row('spine:\u{1F600}'), row('spine:�')].map(line)).map(lineageLineKey))
      .toEqual(['spine:�', 'spine:\u{1F600}']);
  });

  it('round-trips params through their canonical text, read as rows or as lines', () => {
    const text = stageLineageText(CODES, [line(row('spine:2', 'demo.kept', { source: '42', via: 'tyc' }))]);
    expect(paramsOf([...lineageRows(text, 'fixture/demo.tsv')][0])).toEqual({ source: '42', via: 'tyc' });
    expect(paramsOf(decodeLineageLine([...lineageLines(text, 'fixture/demo.tsv')][0])))
      .toEqual({ source: '42', via: 'tyc' });
  });
});

describe('the writer', () => {
  it('refuses a code the stage does not declare, and another stage\'s row', () => {
    expect(() => line(row('spine:2', 'demo.unrecorded'))).toThrow(/demo.unrecorded is not a declared demo code/);
    expect(() => line({ ...row('spine:2'), stage: 'other' })).toThrow(/a row of stage other in the demo file/);
  });

  it('refuses another stage\'s line, and a cell holding a character below tab', () => {
    const otherCodes = stageCodes('other', { kept: { description: 'kept', effect: 'none', status: LIVE } });
    const other = stageLineageLine(otherCodes, { ...row('spine:2'), stage: 'other', code: 'other.kept' });
    expect(() => stageLineageText(CODES, [other])).toThrow(/a line of another stage in the demo file/);
    expect(() => encodeLineageLine(row('spine:\u0001'))).toThrow(/control character below tab/);
  });

  it('refuses an undeclarable code name', () => {
    expect(() => stageCodes('demo', { 'Bad Name': { description: 'x', effect: 'none', status: LIVE } }))
      .toThrow(/not lowercase dotted words/);
  });
});

describe('diffLineage', () => {
  it('reports added, removed and changed keys, a changed key by its differing lines only', () => {
    const before = sortLineageLines(
      [row('spine:2'), row('spine:3'), row('spine:4', 'demo.kept', { source: '1' })].map(line),
    );
    const after = sortLineageLines(
      [row('spine:3'), row('spine:4', 'demo.kept', { source: '2' }), row('spine:5')].map(line),
    );
    const changes = diffLineage(before, after);
    expect(changes.map((c) => [c.kind, c.key])).toEqual([
      ['removed', 'spine:2'], ['changed', 'spine:4'], ['added', 'spine:5'],
    ]);
    expect(changes[1].removed.map((l) => paramsOf(decodeLineageLine(l)))).toEqual([{ source: '1' }]);
    expect(changes[1].added.map((l) => paramsOf(decodeLineageLine(l)))).toEqual([{ source: '2' }]);
    const note = [{ name: 'note', of: (k: string) => `n:${k}` }];
    const text = Buffer.from(stageDiffText(changes, note)).toString('utf8');
    expect(text.split('\n')[2])
      .toBe('changed\t-\tdemo\tspine:4\toutcome\tdemo.kept\t{"source":"1"}\t\tn:spine:4');
    expect(Buffer.from(stageDiffText(changes, note, 1)).toString('utf8')).toBe(text);
  });
});

describe('judgeBaseline', () => {
  const header = (commit: string, dirty = false): StageHeader => ({
    stage: 'demo', version: '1.0.0', commit, dirty, inputHash: 'h', files: ['demo.tsv.gz'],
  });

  it('diffs a baseline built at the merge-base, and nothing when there is none', () => {
    expect(judgeBaseline({ kind: 'checkout', header: { kind: 'read', header: header('abc') } }, 'abc', false))
      .toEqual({ kind: 'diff', why: 'merge-base' });
    expect(judgeBaseline({ kind: 'absent' }, 'abc', false)).toEqual({ kind: 'none' });
  });

  it('refuses any other baseline, naming its commit, unless told to accept it', () => {
    const refused = judgeBaseline({ kind: 'checkout', header: { kind: 'read', header: header('old') } }, 'abc', false);
    expect(refused.kind).toBe('refused');
    expect(refused.kind === 'refused' && refused.message).toMatch(/built at old, not the merge-base abc/);
    expect(judgeBaseline({ kind: 'checkout', header: { kind: 'read', header: header('old') } }, 'abc', true))
      .toEqual({ kind: 'diff', why: 'accepted' });
    expect(judgeBaseline({ kind: 'against', dir: '/elsewhere' }, null, false))
      .toEqual({ kind: 'diff', why: 'against' });
  });

  it('pins a merge-base baseline in lineage.previous: diffs against it and never rotates over it', () => {
    const read = (commit: string, dirty = false) => ({ kind: 'read' as const, header: header(commit, dirty) });
    const branchBuild = { kind: 'checkout' as const, header: read('branch') };
    expect(planBaseline(read('abc'), branchBuild, 'abc', false))
      .toEqual({ verdict: { kind: 'diff', why: 'merge-base' }, from: 'previous', rotate: false });
    expect(planBaseline({ kind: 'missing' }, { kind: 'checkout', header: read('abc') }, 'abc', false))
      .toEqual({ verdict: { kind: 'diff', why: 'merge-base' }, from: 'current', rotate: true });
    expect(planBaseline(read('abc', true), branchBuild, 'abc', false))
      .toMatchObject({ verdict: { kind: 'refused' }, from: null, rotate: true });
    expect(planBaseline(read('abc'), { kind: 'against', dir: '/x' }, 'abc', false))
      .toEqual({ verdict: { kind: 'diff', why: 'against' }, from: 'against', rotate: false });
  });

  it('refuses, never crashes on, a header an older build wrote in another shape', () => {
    const verdict = judgeBaseline({ kind: 'checkout', header: { kind: 'unreadable', reason: 'no dirty flag' } }, 'abc', false);
    expect(verdict.kind === 'refused' && verdict.message).toMatch(/header does not read \(no dirty flag\)/);
  });

  it('refuses a baseline built over uncommitted edits, even at the merge-base', () => {
    const dirty = judgeBaseline({ kind: 'checkout', header: { kind: 'read', header: header('abc', true) } }, 'abc', false);
    expect(dirty.kind === 'refused' && dirty.message).toMatch(/built at abc with uncommitted edits/);
    expect(judgeBaseline({ kind: 'checkout', header: { kind: 'read', header: header('abc', true) } }, 'abc', true))
      .toEqual({ kind: 'diff', why: 'accepted' });
  });
});

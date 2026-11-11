import { describe, expect, it } from 'vitest';

import { diffLineage, stageDiffText } from './lineage-diff-pure';
import {
  compareUtf8, decodeLineageLine, encodeLineageLine, evidenceTexts, foldStageLines, lineageLineKey, lineageLines, lineageRows, paramsOf,
  paramsText, sortLineageLines, sortUtf8, stageLineageLine, stageLineageText, type LineageLine, type LineageRow,
} from './lineage-row-pure';
import { outcomeCode, refusalCode, stageCodes } from './reason-codes/reason-codes-pure';

const CODES = stageCodes('demo', {
  also: outcomeCode('also'),
  kept: outcomeCode('kept'),
  'gate.refused': refusalCode('refused by the gate'),
});

function row(key: string, code = 'demo.kept', params: Record<string, string> = {}): LineageRow {
  return { stage: 'demo', key, role: 'outcome', code, params: paramsText(params), evidence: [] };
}

const line = (r: LineageRow): LineageLine => stageLineageLine(CODES, r);

describe('evidenceTexts', () => {
  it('cites each row once, in first-seen order, and never the origin row', () => {
    expect(evidenceTexts('spine:1', ['gaia:2', 'spine:1', 'hip:3', 'gaia:2'])).toEqual(['gaia:2', 'hip:3']);
  });

  it('cites nothing when every row is the origin', () => {
    expect(evidenceTexts('spine:1', ['spine:1'])).toEqual([]);
  });
});

const refusedRow = (key: string): LineageRow => ({ ...row(key, 'demo.gate.refused'), role: 'refused' });

describe('foldStageLines', () => {
  it('counts every line per code, both roles in one record, every declared code present', () => {
    const lines = [row('spine:1'), row('spine:2'), refusedRow('spine:2'), refusedRow('spine:3')].map(line);
    expect(foldStageLines(CODES, lines)).toEqual({ 'demo.also': 0, 'demo.kept': 2, 'demo.gate.refused': 2 });
  });

  it('refuses a line in a role its code is not declared in', () => {
    const misfiled = [...lineageLines(
      `stage\tkey\trole\tcode\tparams\tevidence\ndemo\tspine:1\trefused\tdemo.kept\t\t\n`, 'fixture/demo.tsv',
    )];
    expect(() => foldStageLines(CODES, misfiled)).toThrow(/demo.kept is declared outcome, written refused \(key spine:1\)/);
  });

  it('refuses a line of another stage', () => {
    const other = stageCodes('other', { kept: outcomeCode('kept') });
    const foreign = stageLineageLine(other, { ...row('spine:1', 'other.kept'), stage: 'other' });
    expect(() => foldStageLines(CODES, [foreign])).toThrow(/"other.kept" is not one of the declared variants/);
  });

  it('keys on live codes only, and refuses a line under a retired code', () => {
    const codes = stageCodes('demo', {
      kept: outcomeCode('kept'),
      gone: outcomeCode('gone', 'none', { kind: 'retired', retiredIn: '1.0.0' } as const),
    });
    const kept = stageLineageLine(codes, row('spine:1'));
    const counts = foldStageLines(codes, [kept]);
    expect(counts).toEqual({ 'demo.kept': 1 });
    // @ts-expect-error a retired code is not a key of the stage's counts
    expect(counts['demo.gone']).toBeUndefined();
    const retired = stageLineageLine(codes, row('spine:2', 'demo.gone'));
    expect(() => foldStageLines(codes, [retired])).toThrow(/"demo.gone" is not one of the declared variants/);
  });
});

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
      row('spine:1', 'demo.also'), refusedRow('spine:1'), row('spine:1'),
    ].map(line);
    expect(sortLineageLines(lines).map(decodeLineageLine)).toEqual([
      row('spine:1', 'demo.also'), row('spine:1'), { ...row('spine:1'), evidence: ['tyc:1-2'] },
      { ...row('spine:1'), evidence: ['tyc:1', 'tyc:1-2'] }, row('spine:1', 'demo.kept', { source: 'a' }),
      refusedRow('spine:1'), row('spine:10'),
    ]);
  });

  it('the writer refuses lines out of lineage order, as the diff does', () => {
    const outOfOrder = [line(row('spine:3')), line(row('spine:2'))];
    expect(() => stageLineageText(CODES, outOfOrder)).toThrow(/demo file is not in lineage order at key spine:2/);
    expect(() => diffLineage(outOfOrder, [])).toThrow(/not in lineage order/);
  });

  it('orders by code point, so an astral character sorts after U+FFFD', () => {
    expect(compareUtf8('\u{1F600}', '\uFFFD')).toBe(1);
    expect(compareUtf8('a', 'ab')).toBe(-1);
    expect(compareUtf8('b', 'a')).toBe(1);
    expect(sortLineageLines([row('spine:\u{1F600}'), row('spine:\uFFFD')].map(line)).map(lineageLineKey))
      .toEqual(['spine:\uFFFD', 'spine:\u{1F600}']);
  });

  it('compareUtf8 and sortUtf8 agree with UTF-8 byte order, with and without units at or above U+D800', () => {
    const ascii = ['spine:2', 'spine:10', 'gaia-dr3:9', 'gaia-dr3:18014398509481985', 'a', 'ab', '', '\u07FF', '\uD7FF'];
    const high = [...ascii, '\u{1F600}', '\uFFFF', '\uE000', '\uFFFD', 'spine:\u{10000}', 'spine:\uFFFF'];
    const byBytes = (x: string, y: string): number => Buffer.compare(Buffer.from(x), Buffer.from(y));
    for (const set of [ascii, high]) {
      for (const x of set) for (const y of set) expect(Math.sign(compareUtf8(x, y))).toBe(byBytes(x, y));
      expect(sortUtf8([...set].reverse(), (s) => s)).toEqual([...set].sort(byBytes));
      expect(sortUtf8(set.map((key) => ({ key })), (r) => r.key).map((r) => r.key)).toEqual([...set].sort(byBytes));
    }
  });

  it('round-trips params through their canonical text, read as rows or as lines', () => {
    const text = stageLineageText(CODES, [line(row('spine:2', 'demo.kept', { source: '42', via: 'tyc' }))]);
    expect(paramsOf([...lineageRows(text, 'fixture/demo.tsv')][0])).toEqual({ source: '42', via: 'tyc' });
    expect(paramsOf(decodeLineageLine([...lineageLines(text, 'fixture/demo.tsv')][0])))
      .toEqual({ source: '42', via: 'tyc' });
  });
});

describe('the writer', () => {
  it('refuses a code the stage does not declare, one in another role than declared, and another stage\'s row', () => {
    expect(() => line(row('spine:2', 'demo.unrecorded'))).toThrow(/demo.unrecorded is not a declared demo code/);
    expect(() => line(row('spine:2', 'demo.gate.refused'))).toThrow(/demo.gate.refused is declared refused, written outcome/);
    expect(() => line({ ...row('spine:2'), stage: 'other' })).toThrow(/a row of stage other in the demo file/);
  });

  it('refuses another stage\'s line, and a cell holding a character below tab', () => {
    const otherCodes = stageCodes('other', { kept: outcomeCode('kept') });
    const other = stageLineageLine(otherCodes, { ...row('spine:2'), stage: 'other', code: 'other.kept' });
    expect(() => stageLineageText(CODES, [other])).toThrow(/a line of another stage in the demo file/);
    expect(() => encodeLineageLine(row('spine:\u0001'))).toThrow(/control character below tab/);
  });

  it('refuses an undeclarable code name', () => {
    expect(() => stageCodes('demo', { 'Bad Name': outcomeCode('x') }))
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

  it('diffs a key\'s lines as a set, so a repeated line is no change', () => {
    const once = [line(row('spine:2')), line(row('spine:3'))];
    const twice = [line(row('spine:2')), line(row('spine:2')), line(row('spine:3'))];
    expect(diffLineage(once, twice)).toEqual([]);
    expect(diffLineage(twice, once)).toEqual([]);
  });
});

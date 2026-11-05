import { describe, expect, it } from 'vitest';

import type { Cell } from './columns-pure';
import { bandCheck, coverageCheck, spotRowCheck, type SpotRow } from './gates-pure';

const row = (cells: Record<string, string | null>): Cell => (column) => cells[column] ?? null;

describe('bandCheck', () => {
  it('passes inside the band, both ends inclusive, and fails outside it', () => {
    expect([9, 10, 20, 21].map((n) => bandCheck('t', n, { min: 10, max: 20 }).kind)).toEqual(['fail', 'pass', 'pass', 'fail']);
  });
});

describe('spotRowCheck', () => {
  const rows = [row({ hip: '1', plx: '3.5', sp: 'G2V', rv: null }), row({ hip: '2', plx: '1.0', sp: 'K0', rv: '4' })];
  const pin = (cells: SpotRow['cells'], value = '1'): SpotRow => ({ key: 'hip', value, cells });

  it('passes exact text, a number within its tolerance and an empty cell', () => {
    expect(spotRowCheck('t', rows, [pin({ sp: 'G2V', plx: { near: 3.45, within: 0.1 }, rv: null })]).kind).toBe('pass');
  });

  it('reports every drifted cell and every missing row at once', () => {
    const check = spotRowCheck('t', rows, [pin({ sp: 'G2', plx: { near: 3, within: 0.1 }, rv: '1' }), pin({}, '9')]);
    expect(check).toMatchObject({ kind: 'fail' });
    expect(check.kind === 'fail' && check.message).toBe([
      't: spot rows drifted:',
      '  hip=1 sp: expected G2, got G2V',
      '  hip=1 plx: expected 3 ±0.1, got 3.5',
      '  hip=1 rv: expected 1, got empty',
      '  hip=9: missing',
    ].join('\n'));
  });

  it('an empty cell never matches a numeric pin', () => {
    expect(spotRowCheck('t', rows, [pin({ rv: { near: 0, within: 1e9 } })]).kind).toBe('fail');
  });
});

describe('coverageCheck', () => {
  const rows = [
    row({ id: 'a', geo: '1', photo: null }),
    row({ id: 'b', geo: null, photo: '2' }),
    row({ id: 'c', geo: null, photo: null }),
  ];
  const groups = [
    { name: 'geo', has: (c: Cell) => c('geo') !== null },
    { name: 'photo', has: (c: Cell) => c('photo') !== null },
  ] as const;

  it('reports each group and the union over the request', () => {
    const check = coverageCheck('t', rows, 'id', 4, { groups: [...groups] });
    expect(check).toEqual({
      kind: 'pass',
      report: 't: coverage of 4 requested\n  row present 3 (75.0%)\n  geo 1 (25.0%)\n  photo 1 (25.0%)\n  union 2 (50.0%)',
    });
  });

  it('fails under the floor and passes at it', () => {
    expect(coverageCheck('t', rows, 'id', 4, { groups: [...groups], floor: 0.6 }).kind).toBe('fail');
    expect(coverageCheck('t', rows, 'id', 4, { groups: [...groups], floor: 0.5 }).kind).toBe('pass');
  });

  it('counts an id that answers several rows once, so its extra rows cannot stand in for a missing id', () => {
    const many = [row({ id: 'a', geo: '1' }), row({ id: 'a', geo: '2' }), row({ id: 'a', geo: '3' })];
    const check = coverageCheck('t', many, 'id', 2, { groups: [groups[0]], floor: 0.6 });
    expect(check.kind).toBe('fail');
    expect(check.kind === 'fail' && check.report).toBe('t: coverage of 2 requested\n  row present 1 (50.0%)\n  geo 1 (50.0%)\n  union 1 (50.0%)');
  });
});

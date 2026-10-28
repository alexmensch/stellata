import { describe, expect, it } from 'vitest';

import { applyCellSets, evidenceOf, type CorrectedTable } from './cell-corrections-pure';
import { readTable } from './table-pure';

type Row = Record<'id' | 'v', string>;
const TABLE: CorrectedTable<Row, 'v'> = {
  file: 'data/fixes.tsv',
  target: 'thing',
  keyOf: (r) => r.id,
  get: (r, c) => r[c],
  with: (r, c, value) => ({ ...r, [c]: value }),
};
const ROWS: Row[] = [{ id: 'a', v: '1' }, { id: 'b', v: '2' }];

describe('applyCellSets', () => {
  it('rewrites the keyed cell and leaves the input untouched', () => {
    expect(applyCellSets(ROWS, [{ key: 'b', cell: 'v', value: '' }], TABLE))
      .toEqual([{ id: 'a', v: '1' }, { id: 'b', v: '' }]);
    expect(ROWS[1].v).toBe('2');
  });

  it('refuses a set keying no row', () => {
    expect(() => applyCellSets(ROWS, [{ key: 'z', cell: 'v', value: '3' }], TABLE))
      .toThrow('data/fixes.tsv: row "z" matches no thing row');
  });

  it('refuses a set restating the value the row already holds', () => {
    expect(() => applyCellSets(ROWS, [{ key: 'a', cell: 'v', value: '1' }], TABLE))
      .toThrow('data/fixes.tsv: row a sets v to the value the thing already states; remove it');
  });
});

describe('evidenceOf', () => {
  it('answers the evidence cell, or fails a row stating none', () => {
    const spec = { file: 'data/fixes.tsv', columns: ['id', 'evidence'] as const, hint: 'Curate it.' };
    const [ok, bare] = readTable(spec, 'id\tevidence\na\tseen\nb\t \n');
    expect(evidenceOf(ok, 'evidence', 'a')).toBe('seen');
    expect(() => evidenceOf(bare, 'evidence', 'b')).toThrow('data/fixes.tsv:3: row b states no evidence. Curate it.');
  });
});

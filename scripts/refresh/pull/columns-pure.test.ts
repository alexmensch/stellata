import { describe, expect, it } from 'vitest';

import { cellReader, checkedRows, formatTsv, projection, type Column } from './columns-pure';

const COLUMNS: readonly Column[] = [
  { name: 'source_id', select: 't.source_id' },
  { name: 'RA(ICRS)' },
  { name: 'plx', format: (cell) => Number(cell).toFixed(2) },
];

describe('projection', () => {
  it('quotes a bare name and keeps a stated projection', () => {
    expect(projection(COLUMNS, (id) => `"${id}"`)).toBe('t.source_id, "RA(ICRS)", "plx"');
  });
});

describe('checkedRows', () => {
  const result = { columns: ['source_id', 'RA(ICRS)', 'plx'], rows: [['1', '10.5', null]] };

  it('passes a reply whose header is the declared columns, in order', () => {
    expect(checkedRows(COLUMNS, result, 't')).toEqual([['1', '10.5', null]]);
  });

  it('refuses a missing, extra or reordered column', () => {
    for (const columns of [['source_id', 'plx'], ['source_id', 'RA(ICRS)', 'plx', 'x'], ['RA(ICRS)', 'source_id', 'plx']]) {
      expect(() => checkedRows(COLUMNS, { ...result, columns }, 't')).toThrow(/are not the declared/);
    }
  });
});

describe('cellReader', () => {
  it('reads by name and refuses an undeclared one', () => {
    const cell = cellReader(COLUMNS, 't')(['1', '10.5', null]);
    expect([cell('source_id'), cell('plx')]).toEqual(['1', null]);
    expect(() => cell('nope')).toThrow('t: no column nope');
  });
});

describe('formatTsv', () => {
  it('writes the header, an empty cell for null, formats only present cells, and ends with a newline', () => {
    expect(formatTsv('f.tsv', COLUMNS, [['1', '10.5', '3.14159'], ['2', '11', null]]))
      .toBe('source_id\tRA(ICRS)\tplx\n1\t10.5\t3.14\n2\t11\t\n');
  });

  it('refuses a cell holding a tab', () => {
    expect(() => formatTsv('f.tsv', COLUMNS, [['1', 'a\tb', null]])).toThrow('f.tsv: cell RA(ICRS)="a\tb" contains a TSV delimiter');
  });
});

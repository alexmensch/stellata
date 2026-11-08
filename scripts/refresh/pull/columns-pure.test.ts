import { describe, expect, it } from 'vitest';

import { cellReader, checkedRows, formatTsv, projection, sortRows, type Column } from './columns-pure';

const COLUMNS: readonly Column[] = [
  { name: 'source_id', select: 't.source_id' },
  { name: 'RA(ICRS)' },
  { name: 'plx', format: { fixed: 2 } },
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

describe('sortRows', () => {
  const cols: readonly Column[] = [{ name: 'id' }, { name: 'sep' }, { name: 'name' }];

  it('orders integers exactly past 2^53, then decimals, with an empty cell first', () => {
    const rows = [
      ['5948276404969751808', '0.5', 'b'],
      ['5948276404969751807', null, 'a'],
      ['10', '2', 'c'],
      ['9', '1', 'd'],
      ['5948276404969751807', '0.25', 'e'],
    ];
    const keys = [{ column: 'id', as: 'integer' }, { column: 'sep', as: 'decimal' }] as const;
    expect(sortRows(cols, rows, keys, 't').map((r) => r[2])).toEqual(['d', 'c', 'a', 'e', 'b']);
  });

  it('orders text by code unit, the same on every machine', () => {
    expect(sortRows(cols, [['1', '1', 'b'], ['1', '1', 'B'], ['1', '1', 'a']], [{ column: 'name', as: 'text' }], 't').map((r) => r[2]))
      .toEqual(['B', 'a', 'b']);
  });

  it('refuses a key that is not a declared column', () => {
    expect(() => sortRows(cols, [], [{ column: 'nope', as: 'text' }], 't')).toThrow('t: no column nope');
  });
});

describe('formatTsv', () => {
  it('writes the header, an empty cell for null, formats only present cells, and ends with a newline', () => {
    expect(formatTsv('f.tsv', COLUMNS, [['1', '10.5', '3.14159'], ['2', '11', null]]))
      .toBe('source_id\tRA(ICRS)\tplx\n1\t10.5\t3.14\n2\t11\t\n');
  });

  it('formats a float32 column\'s float32 value, as Python did, not the reply\'s text', () => {
    const fixed: Column[] = [{ name: 'd', format: { fixed: 6, float32: true } }];
    expect(formatTsv('f.tsv', fixed, [['0.1570405'], ['1.0490755']])).toBe('d\n0.157041\n1.049075\n');
    expect(formatTsv('f.tsv', [{ name: 'd', format: { fixed: 6 } }], [['0.1570405'], ['1.0490755']])).toBe('d\n0.157040\n1.049076\n');
  });

  it('rounds as Python does, and refuses a formatted cell that is not a number', () => {
    expect(formatTsv('f.tsv', COLUMNS, [['1', 'x', '0.125']])).toBe('source_id\tRA(ICRS)\tplx\n1\tx\t0.12\n');
    expect(() => formatTsv('f.tsv', COLUMNS, [['1', 'x', 'n/a']])).toThrow('f.tsv: plx="n/a" has a numeric format but is not a number');
  });

  it('refuses a cell holding a tab', () => {
    expect(() => formatTsv('f.tsv', COLUMNS, [['1', 'a\tb', null]])).toThrow('f.tsv: cell RA(ICRS)="a\tb" contains a TSV delimiter');
  });
});

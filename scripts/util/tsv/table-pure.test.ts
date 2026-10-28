import { describe, expect, it } from 'vitest';

import { floatCell, intCell, readTable, tableLineReader, textCell, type TableSpec } from './table-pure';

const SPEC: TableSpec<'id' | 'v'> = { file: 'data/t.tsv', columns: ['id', 'v'], hint: 'Re-run x.' };

describe('cells', () => {
  it('reads empty as null and trims', () => {
    expect(textCell(' a ')).toBe('a');
    expect(textCell('  ')).toBeNull();
    expect(textCell(undefined)).toBeNull();
    expect(floatCell('')).toBeNull();
    expect(intCell(undefined)).toBeNull();
  });

  it('parses decimals and integers', () => {
    expect(floatCell(' -1.5e3 ')).toBe(-1500);
    expect(floatCell('.5')).toBe(0.5);
    expect(floatCell('7.')).toBe(7);
    expect(intCell('-42')).toBe(-42);
  });

  it('throws on a malformed non-empty cell rather than reading it as absent', () => {
    for (const bad of ['12abc', 'nan', 'Infinity', '0x1A', '1,5']) {
      expect(() => floatCell(bad)).toThrow(/not a decimal/);
    }
    expect(() => intCell('12.0')).toThrow(/not an integer/);
  });
});

describe('readTable', () => {
  it('resolves columns by name in any order and skips blank lines', () => {
    const rows = [...readTable(SPEC, 'x\tv\tid\r\n1\t2.5\tA\n\n\t\tB\n')];
    expect(rows.map((r) => [r.text('id'), r.float('v'), r.line])).toEqual([['A', 2.5, 2], ['B', null, 4]]);
  });

  it('reads a cell past the end of a short row as empty', () => {
    const [row] = readTable(SPEC, 'id\tv\nA\n');
    expect(row.raw('v')).toBe('');
    expect(row.float('v')).toBeNull();
  });

  it('throws on a missing column and on an empty file', () => {
    expect(() => [...readTable(SPEC, 'id\nA\n')]).toThrow('data/t.tsv is missing required columns: v. Re-run x.');
    expect(() => [...readTable(SPEC, '')]).toThrow(/missing required columns: id, v/);
  });

  it('names file, line and column on a malformed cell', () => {
    const [, row] = readTable(SPEC, 'id\tv\nA\t1\nB\t1x\n');
    expect(() => row.float('v')).toThrow('data/t.tsv:3: v: "1x" is not a decimal number. Re-run x.');
  });

  it('checks an exact table byte for byte', () => {
    const exact = { ...SPEC, exact: true };
    expect(() => [...readTable(exact, 'v\tid\n')]).toThrow(/header mismatch/);
    expect(() => [...readTable(exact, 'id\tv\nA\n')]).toThrow(/row has 1 cells, expected 2/);
    expect([...readTable(exact, 'id\tv\nA\t\n')]).toHaveLength(1);
  });

  it('oneOf accepts only the listed values', () => {
    const [row] = readTable(SPEC, 'id\tv\nA\tq\n');
    expect(row.oneOf('id', ['A', 'B'] as const)).toBe('A');
    expect(() => row.oneOf('v', ['p'] as const)).toThrow(/v: "q" is not one of p/);
  });
});

describe('tableLineReader', () => {
  it('folds the same rows as readTable', () => {
    const seen: string[] = [];
    const feed = tableLineReader(SPEC, (r) => seen.push(r.raw('id')));
    for (const line of ['v\tid', '1\tA', '', '2\tB']) feed(line);
    expect(seen).toEqual(['A', 'B']);
  });
});

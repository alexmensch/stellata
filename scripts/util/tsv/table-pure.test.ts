import { describe, expect, it } from 'vitest';

import {
  compareSourceIds, floatCell, idCell, idListCell, intCell, readTable, tableLineReader, textCell, type TableSpec,
} from './table-pure';

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
    expect(() => intCell('-9007199254740993')).toThrow(/past the safe integer range/);
    expect(intCell('-9007199254740991')).toBe(-Number.MAX_SAFE_INTEGER);
  });

  it('orders source_ids absent first, then by value past 2^53', () => {
    const ids = ['9007199254740993', '', '30', null, '9007199254740992', '100'];
    expect([...ids].sort(compareSourceIds)).toEqual(['', null, '30', '100', '9007199254740992', '9007199254740993']);
    expect(compareSourceIds(null, '')).toBe(0);
  });

  it('reads an identifier only as the text it writes back to', () => {
    expect(idCell('0')).toBe(0);
    expect(idCell('48915')).toBe(48915);
    expect(idCell('')).toBeNull();
    for (const bad of ['048915', '+1', '-1', ' 1', '1.0']) {
      expect(() => idCell(bad)).toThrow(/is not an identifier/);
    }
    expect(() => idCell('9007199254740993')).toThrow(/past the safe integer range/);
    expect(idListCell('3|1|20', '|')).toEqual([3, 1, 20]);
    expect(idListCell('', '|')).toEqual([]);
    expect(() => idListCell('3||1', '|')).toThrow(/"3\|\|1" has an empty element/);
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

  it('reads an omitted optional column as empty, and says it was omitted', () => {
    const spec = { ...SPEC, columns: ['id'] as const, optional: ['v'] as const };
    const [row] = readTable(spec, 'id\nA\n');
    expect([row.has('v'), row.raw('v'), row.float('v')]).toEqual([false, '', null]);
    const [withV] = readTable(spec, 'v\tid\n2\tA\n');
    expect([withV.has('v'), withV.float('v')]).toEqual([true, 2]);
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

  it('reads a source_id as bare digits, kept a string', () => {
    const [row] = readTable(SPEC, 'id\tv\n4295806720123456789\t\n');
    expect(row.sourceId('id')).toBe('4295806720123456789');
    expect(row.requiredSourceId('id')).toBe('4295806720123456789');
    expect(row.sourceId('v')).toBeNull();
    expect(() => row.requiredSourceId('v')).toThrow('data/t.tsv:2: v: is empty. Re-run x.');
    const [bad] = readTable(SPEC, 'id\tv\n-12\t1e3\n');
    expect(() => bad.sourceId('id')).toThrow('data/t.tsv:2: id: "-12" is not a source_id. Re-run x.');
    expect(() => bad.requiredSourceId('v')).toThrow(/v: "1e3" is not a source_id/);
  });

  it('names file, line and column on a bad identifier', () => {
    const [row] = readTable(SPEC, 'id\tv\n07\t1||2\n');
    expect(() => row.id('id')).toThrow('data/t.tsv:2: id: "07" is not an identifier. Re-run x.');
    expect(() => row.idList('v', '|')).toThrow(/data\/t\.tsv:2: v: "1\|\|2" has an empty element/);
    const [empty] = readTable(SPEC, 'id\tv\n\t3|4\n');
    expect(() => empty.requiredId('id')).toThrow('data/t.tsv:2: id: is empty. Re-run x.');
    expect(empty.idList('v', '|')).toEqual([3, 4]);
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

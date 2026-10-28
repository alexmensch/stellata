import { describe, expect, it } from 'vitest';

import {
  compareSourceIds, floatCell, idCell, idListCell, intCell, readTable, tableLineReader, textCell, type TableSpec,
} from './table-pure';

const SPEC: TableSpec<'id' | 'v'> = { file: 'fixture/t.tsv', columns: ['id', 'v'], hint: 'Re-run x.' };

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

  it('cells keys every spec column, optional ones included, by its raw cell', () => {
    const spec = { ...SPEC, columns: ['id'] as const, optional: ['v'] as const };
    const [row] = readTable(spec, 'x\tid\n9\t A \n');
    expect(row.cells()).toEqual({ id: ' A ', v: '' });
  });

  it('reads an omitted optional column as empty, and says it was omitted', () => {
    const spec = { ...SPEC, columns: ['id'] as const, optional: ['v'] as const };
    const [row] = readTable(spec, 'id\nA\n');
    expect([row.has('v'), row.raw('v'), row.float('v')]).toEqual([false, '', null]);
    const [withV] = readTable(spec, 'v\tid\n2\tA\n');
    expect([withV.has('v'), withV.float('v')]).toEqual([true, 2]);
  });

  it('throws on a missing column and on an empty file', () => {
    expect(() => [...readTable(SPEC, 'id\nA\n')]).toThrow('fixture/t.tsv is missing required columns: v. Re-run x.');
    expect(() => [...readTable(SPEC, '')]).toThrow('fixture/t.tsv has no header row: expected columns id, v. Re-run x.');
    expect(() => [...readTable(SPEC, '\n\n')]).toThrow(/has no header row/);
  });

  it('throws on a requested column the header names twice, and ignores other repeats', () => {
    expect(() => [...readTable(SPEC, 'id\tv\tid\nA\t1\tB\n')]).toThrow('fixture/t.tsv header names id more than once. Re-run x.');
    const spec = { ...SPEC, columns: ['id'] as const, optional: ['v'] as const };
    expect(() => [...readTable(spec, 'v\tid\tv\n1\tA\t2\n')]).toThrow(/header names v more than once/);
    expect([...readTable(SPEC, 'x\tid\tx\tv\n0\tA\t0\t1\n')][0].raw('id')).toBe('A');
  });

  it('yields no rows from a header alone, with or without a final newline', () => {
    expect([...readTable(SPEC, 'id\tv\n')]).toEqual([]);
    expect([...readTable(SPEC, 'v\tid')]).toEqual([]);
    expect([...readTable({ ...SPEC, exact: true }, 'id\tv\n')]).toEqual([]);
  });

  it('skips blank lines before the header', () => {
    const rows = [...readTable(SPEC, '\n  \nid\tv\nA\t1\n')];
    expect(rows.map((r) => [r.raw('id'), r.line])).toEqual([['A', 4]]);
  });

  it('skips comment lines anywhere when the spec says so, numbering lines physically', () => {
    const spec = { ...SPEC, comments: true } as const;
    const text = '# preamble\n#\nid\tv\n# note\nA\t1\n  # indented\nB\t1x\n';
    const rows = [...readTable(spec, text)];
    expect(rows.map((r) => [r.raw('id'), r.line])).toEqual([['A', 5], ['B', 7]]);
    expect(() => rows[1].float('v')).toThrow('fixture/t.tsv:7: v: "1x" is not a decimal number. Re-run x.');
    expect(() => [...readTable(spec, '# only a comment\n')]).toThrow(/has no header row/);
  });

  it('reads a # row as data when the spec does not take comments', () => {
    const [row] = readTable(SPEC, 'id\tv\n#A\t1\n');
    expect(row.raw('id')).toBe('#A');
  });

  it('names file, line and column on a malformed cell', () => {
    const [, row] = readTable(SPEC, 'id\tv\nA\t1\nB\t1x\n');
    expect(() => row.float('v')).toThrow('fixture/t.tsv:3: v: "1x" is not a decimal number. Re-run x.');
  });

  it('checks an exact table byte for byte', () => {
    const exact = { ...SPEC, exact: true };
    expect(() => [...readTable(exact, 'v\tid\n')]).toThrow(/header mismatch/);
    expect(() => [...readTable(exact, 'id\tv\nA\n')]).toThrow(/row has 1 cells, expected 2/);
    expect([...readTable(exact, 'id\tv\nA\t\n')]).toHaveLength(1);
  });

  it('holds an exact table to its layout: LF only, no blank line, a final newline', () => {
    const exact = { ...SPEC, exact: true };
    expect(() => [...readTable(exact, 'id\tv\r\nA\t1\r\n')]).toThrow('fixture/t.tsv:1: CR line ending. Re-run x.');
    expect(() => [...readTable(exact, 'id\tv\nA\t1\r\n')]).toThrow(/fixture\/t\.tsv:2: CR line ending/);
    expect(() => [...readTable(exact, 'id\tv\nA\t1\n\nB\t2\n')]).toThrow('fixture/t.tsv:3: blank line. Re-run x.');
    expect(() => [...readTable(exact, 'id\tv\nA\t1')]).toThrow('fixture/t.tsv: missing final newline. Re-run x.');
    expect([...readTable(SPEC, 'id\tv\r\nA\t1\r\n\nB\t2')].map((r) => r.raw('id'))).toEqual(['A', 'B']);
  });

  it('keeps each row\'s line as written', () => {
    const rows = [...readTable(SPEC, 'id\tv\n A \t1\r\n')];
    expect(rows[0].rawLine).toBe(' A \t1');
  });

  it('reads a source_id as bare digits, kept a string', () => {
    const [row] = readTable(SPEC, 'id\tv\n4295806720123456789\t\n');
    expect(row.sourceId('id')).toBe('4295806720123456789');
    expect(row.requiredSourceId('id')).toBe('4295806720123456789');
    expect(row.sourceId('v')).toBeNull();
    expect(() => row.requiredSourceId('v')).toThrow('fixture/t.tsv:2: v: is empty. Re-run x.');
    const [bad] = readTable(SPEC, 'id\tv\n-12\t1e3\n');
    expect(() => bad.sourceId('id')).toThrow('fixture/t.tsv:2: id: "-12" is not a source_id. Re-run x.');
    expect(() => bad.requiredSourceId('v')).toThrow(/v: "1e3" is not a source_id/);
    const [list] = readTable(SPEC, 'id\tv\n12|34\t12||34\n');
    expect(list.sourceIdList('id', '|')).toEqual(['12', '34']);
    expect(() => list.sourceIdList('v', '|')).toThrow('fixture/t.tsv:2: v: is empty. Re-run x.');
  });

  it('names file, line and column on a bad identifier', () => {
    const [row] = readTable(SPEC, 'id\tv\n07\t1||2\n');
    expect(() => row.id('id')).toThrow('fixture/t.tsv:2: id: "07" is not an identifier. Re-run x.');
    expect(() => row.idList('v', '|')).toThrow(/fixture\/t\.tsv:2: v: "1\|\|2" has an empty element/);
    const [empty] = readTable(SPEC, 'id\tv\n\t3|4\n');
    expect(() => empty.requiredId('id')).toThrow('fixture/t.tsv:2: id: is empty. Re-run x.');
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
    feed.finish();
  });

  it('finish throws when no header was fed', () => {
    const feed = tableLineReader(SPEC, () => {});
    feed('');
    expect(() => feed.finish()).toThrow('fixture/t.tsv has no header row: expected columns id, v. Re-run x.');
  });
});

import { describe, expect, it } from 'vitest';

import { defineArtifact, nullableCell } from './artifact-pure';
import { firstDifferingLine } from './committed-round-trip';

interface Rec { key: string; n: number | null }

const artifact = (order: 'by-line' | 'as-given' | ((a: Rec, b: Rec) => number)) => defineArtifact({
  file: 'data/a.tsv',
  columns: ['key', 'n'] as const,
  hint: 'Re-run y.',
  order,
  decode: (row): Rec => ({ key: row.raw('key'), n: row.int('n') }),
  encode: (r) => ({ key: r.key, n: nullableCell(r.n) }),
});

const RECS: Rec[] = [{ key: 'b', n: 2 }, { key: 'a', n: null }];

describe('defineArtifact', () => {
  it('round-trips through serialize and parse', () => {
    const a = artifact('as-given');
    const text = a.serialize(RECS);
    expect(text).toBe('key\tn\nb\t2\na\t\n');
    expect(a.parse(text)).toEqual(RECS);
    expect(a.serialize(a.parse(text))).toBe(text);
  });

  it('orders by encoded line or by comparator', () => {
    expect(artifact('by-line').serialize(RECS)).toBe('key\tn\na\t\nb\t2\n');
    expect(artifact((x, y) => (y.n ?? 0) - (x.n ?? 0)).serialize(RECS)).toBe('key\tn\nb\t2\na\t\n');
  });

  it('refuses a cell holding a delimiter', () => {
    expect(() => artifact('as-given').serialize([{ key: 'a\tb', n: 1 }])).toThrow(/contains a TSV delimiter/);
    expect(() => artifact('as-given').encodeLine({ key: 'a\nb', n: 1 })).toThrow(/contains a TSV delimiter/);
  });

  it('encodeLine writes the line serialize would, so an append matches a rewrite', () => {
    const a = artifact('as-given');
    const appended = a.serialize(RECS.slice(0, 1)) + `${a.encodeLine(RECS[1])}\n`;
    expect(appended).toBe(a.serialize(RECS));
  });

  it('demands its own header exactly', () => {
    expect(() => artifact('as-given').parse('n\tkey\n')).toThrow(/header mismatch/);
  });

  it('streams the same records through lineReader', () => {
    const seen: Rec[] = [];
    const feed = artifact('as-given').lineReader((r) => seen.push(r));
    for (const line of ['key\tn', 'b\t2', 'a\t']) feed(line);
    expect(seen).toEqual(RECS);
  });
});

describe('firstDifferingLine', () => {
  it('names the first line a round trip changed, and both versions of it', () => {
    expect(firstDifferingLine('h\na\nb\n', 'h\na\nb\n')).toBeNull();
    expect(firstDifferingLine('h\na\nb\n', 'h\na\nc\n')).toEqual({ line: 3, committed: 'b', written: 'c' });
    expect(firstDifferingLine('h\na\n', 'h\na\nb\n')).toEqual({ line: 3, committed: '', written: 'b' });
    expect(firstDifferingLine('h\na', 'h\na\n')).toEqual({ line: 3, committed: '(end of file)', written: '' });
  });
});

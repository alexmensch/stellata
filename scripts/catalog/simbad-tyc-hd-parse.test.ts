import { describe, it, expect } from 'vitest';

import { hdNumbers, parseSimbadTycHdTsv } from './simbad-tyc-hd-parse';

const HEADER = ['tyc', 'simbad_oid', 'simbad_main_id', 'hd'].join('\t');

function tsv(...rows: string[][]): string {
  return [HEADER, ...rows.map((r) => r.join('\t'))].join('\n') + '\n';
}

describe('parseSimbadTycHdTsv', () => {
  it('indexes on the full TYC', () => {
    const index = parseSimbadTycHdTsv(tsv(
      ['7570-1585-1', '7426150', '* f Eri A', '24072'],
      ['7570-1586-1', '687096', '* f Eri B', '24071'],
    ));
    expect([...index.keys()]).toEqual(['7570-1585-1', '7570-1586-1']);
    expect(index.get('7570-1585-1')).toEqual({
      hdIdents: ['24072'], simbadOid: 7426150, mainId: '* f Eri A',
    });
  });

  it('keeps every HD a Tycho entry carries, in file order', () => {
    const row = parseSimbadTycHdTsv(
      tsv(['1-1-1', '9', '', '12447|12448']),
    ).get('1-1-1')!;
    expect(row.hdIdents).toEqual(['12447', '12448']);
  });

  it('preserves a component letter on the ident', () => {
    const row = parseSimbadTycHdTsv(
      tsv(['1-1-1', '9', '', '24071B']),
    ).get('1-1-1')!;
    expect(row.hdIdents).toEqual(['24071B']);
  });

  it('reads a blank main_id as null', () => {
    expect(parseSimbadTycHdTsv(tsv(['1-1-1', '9', '', '1'])).get('1-1-1')!.mainId)
      .toBeNull();
  });

  it('skips a row missing its key, oid or HD rather than indexing a partial', () => {
    const index = parseSimbadTycHdTsv(tsv(
      ['', '9', 'x', '1'],
      ['2-2-2', '', 'x', '1'],
      ['3-3-3', '9', 'x', ''],
      ['4-4-4', '9', 'x', '1'],
    ));
    expect([...index.keys()]).toEqual(['4-4-4']);
  });

  it('hard-fails on a header missing a column, so a truncated pull cannot read as empty', () => {
    expect(() => parseSimbadTycHdTsv('tyc\tsimbad_oid\n1-1-1\t9\n')).toThrow();
  });
});

describe('hdNumbers', () => {
  it('drops the component letter', () => {
    expect(hdNumbers({ hdIdents: ['24071B'], simbadOid: 1, mainId: null }))
      .toEqual([24071]);
  });

  it('deduplicates the bare and lettered forms of one number', () => {
    expect(hdNumbers({
      hdIdents: ['24071', '24071B'], simbadOid: 1, mainId: null,
    })).toEqual([24071]);
  });

  it('keeps two genuinely different numbers in first-seen order', () => {
    expect(hdNumbers({
      hdIdents: ['12448', '12447'], simbadOid: 1, mainId: null,
    })).toEqual([12448, 12447]);
  });

  it('contributes nothing for a suffix with no leading integer', () => {
    expect(hdNumbers({ hdIdents: ['A', ''], simbadOid: 1, mainId: null }))
      .toEqual([]);
  });
});

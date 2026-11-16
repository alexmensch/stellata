import { describe, it, expect } from 'vitest';

import type { CrossIndexRow } from '../classic-ids/classic-ids-parse';
import { normaliseWgsnCell } from './wgsn-normalise-pure';
import type { WgsnRow } from './wgsn-parse-pure';
import {
  bayerKeySets,
  designationFromCell,
  compareDesignationRows,
  duplicateDesignationRows,
  bsc5BayerCells,
  iv27aBayerCells,
  unionBayerTail,
  type DesignationRow,
} from './wgsn-tables-pure';

const row = (over: Partial<WgsnRow> = {}): WgsnRow => ({
  id: '1', name: null, hip: null, hipComponent: null, hr: null, hd: null,
  hdComponent: null, bayerOther: null, vmag: null, wds: null, source: 'nec',
  ...over,
});

const desig = (over: Partial<DesignationRow> = {}): DesignationRow => ({
  kind: 'bayer', letter: 'α', sup: null, num: null, dc: 'Lyr', half: null,
  component: null, hip: null, hr: null, hd: null, source: 'nec', ...over,
});

const xrow = (over: Partial<CrossIndexRow> = {}): CrossIndexRow => ({
  hd: 1, hip: null, bayer: null, flamsteed: null, cst: null, ...over,
});

describe('designationFromCell', () => {
  it('carries the row keys onto every designation kind', () => {
    const keys = row({ hip: 7, hr: 8, hd: 9 });
    expect(designationFromCell(normaliseWgsnCell('τ Phoenicis'), keys))
      .toMatchObject({ kind: 'bayer', letter: 'τ', dc: 'Phe', hip: 7, hr: 8, hd: 9 });
    expect(designationFromCell(normaliseWgsnCell('29 Psc'), keys))
      .toMatchObject({ kind: 'flamsteed', num: 29, letter: null, hip: 7 });
  });

  it('moves the Serpens half onto the half column', () => {
    expect(designationFromCell(normaliseWgsnCell('10 G. Ser Cau'), row()))
      .toMatchObject({ kind: 'gould', num: 10, dc: 'Ser', half: 'Cau' });
  });

  it('emits nothing for the classes that carry no designation', () => {
    for (const cell of ['NGC 129', 'BD+26 128', 'S Scl', null]) {
      expect(designationFromCell(normaliseWgsnCell(cell), row())).toBeNull();
    }
  });
});

describe('bayerKeySets', () => {
  const reached = bayerKeySets([
    desig({ hd: 100 }),
    desig({ hip: 200 }),
    desig({ kind: 'flamsteed', letter: null, num: 5, hd: 300 }),
  ]).reaches;

  const keys = (hip: number | null, hd: number | null, hr: number | null = null) => ({ hip, hr, hd });

  it('matches on any key', () => {
    expect(reached(keys(null, 100))).toBe(true);
    expect(reached(keys(200, null))).toBe(true);
    expect(reached(keys(999, 100))).toBe(true);
    expect(bayerKeySets([desig({ hr: 50 })]).reaches(keys(null, null, 50))).toBe(true);
  });

  it('never matches a keyless row against a populated set', () => {
    expect(reached(keys(null, null))).toBe(false);
  });

  it('ignores designations that are not Bayer', () => {
    expect(reached(keys(null, 300))).toBe(false);
  });
});

describe('unionBayerTail over IV/27A', () => {
  const unionIv27aBayer = (above: DesignationRow[], rows: CrossIndexRow[]) =>
    unionBayerTail(above, iv27aBayerCells(rows), 'iv27a');

  it('adds only the stars no WGSN Bayer row already reaches', () => {
    const u = unionIv27aBayer(
      [desig({ hd: 100 }), desig({ hip: 200 })],
      [
        xrow({ hd: 100, bayer: 'alf', cst: 'Lyr' }),
        xrow({ hd: 201, hip: 200, bayer: 'bet', cst: 'Lyr' }),
        xrow({ hd: 400, bayer: 'gam', cst: 'Cyg' }),
      ],
    );
    expect(u).toMatchObject({ cells: 3, covered: 2, variableRejected: 0, unparsed: 0 });
    expect(u.added).toEqual([desig({
      letter: 'γ', dc: 'Cyg', hd: 400, source: 'iv27a',
    })]);
  });

  it('counts the GCVS contaminants and the unparsed cells apart', () => {
    const u = unionIv27aBayer([], [
      xrow({ hd: 1, bayer: 'RZ', cst: 'Cas' }),
      xrow({ hd: 2, bayer: 'V380', cst: 'Cyg' }),
      xrow({ hd: 3, bayer: '??', cst: 'Cyg' }),
      xrow({ hd: 4, bayer: null, cst: 'Cyg' }),
    ]);
    expect(u).toMatchObject({ cells: 3, variableRejected: 2, unparsed: 1 });
    expect(u.added).toEqual([]);
  });
});

describe('unionBayerTail over V/50', () => {
  it('adds a Bayer no row above reaches, keyed on the HR and HD V/50 prints', () => {
    const u = unionBayerTail([], bsc5BayerCells([{ hr: 3650, hd: 79096, name: '81Pi 1Cnc' }], []), 'v50');
    expect(u.added).toEqual([desig({
      letter: 'π', sup: 1, dc: 'Cnc', hr: 3650, hd: 79096, source: 'v50',
    })]);
  });

  it('reaches through the HIP IV/27A links the HD to, so a pair\'s designation stays on one component', () => {
    const above = [desig({ letter: 'ξ', dc: 'UMa', hip: 55203 })];
    const crossIndex = [xrow({ hd: 98230, hip: 55203, bayer: 'ksi', cst: 'UMa' })];
    const u = unionBayerTail(above, bsc5BayerCells([{ hr: 4374, hd: 98230, name: '53Xi  UMa' }], crossIndex), 'v50');
    expect(u).toMatchObject({ cells: 1, covered: 1, added: [] });
  });

  it('skips a name with no Bayer field without counting it', () => {
    const u = unionBayerTail([], bsc5BayerCells([{ hr: 33, hd: 693, name: '6    Cet' }], []), 'v50');
    expect(u).toMatchObject({ cells: 0, added: [] });
  });
});

describe('designation order', () => {
  it('orders rows independently of input order', () => {
    const rows = [
      desig({ letter: 'β', dc: 'Cyg', hd: 2 }),
      desig({ letter: 'α', dc: 'Cyg', hd: 1 }),
      desig({ kind: 'gould', letter: null, num: 4, dc: 'Cet' }),
    ];
    const forwards = [...rows].sort(compareDesignationRows);
    const backwards = [...rows].reverse().sort(compareDesignationRows);
    expect(forwards).toEqual(backwards);
    expect(forwards.map((d) => d.letter ?? String(d.num))).toEqual(['α', 'β', '4']);
  });

  it('counts rows that tie on every sorted field', () => {
    const dup = desig({ hd: 7 });
    expect(duplicateDesignationRows([dup, { ...dup }, desig({ hd: 8 })])).toBe(1);
  });
});

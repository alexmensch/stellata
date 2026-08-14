import { describe, it, expect } from 'vitest';

import type { CrossIndexRow } from '../classic-ids/classic-ids-parse';
import { normaliseWgsnCell } from './wgsn-normalise-pure';
import type { WgsnRow } from './wgsn-parse-pure';
import {
  bayerKeySets,
  designationFromCell,
  diffDispositions,
  parseDispositionKeys,
  sortDesignations,
  spineProperKey,
  unionIv27aBayer,
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

  it('matches on either key', () => {
    expect(reached(null, 100)).toBe(true);
    expect(reached(200, null)).toBe(true);
    expect(reached(999, 100)).toBe(true);
  });

  it('never matches a keyless row against a populated set', () => {
    expect(reached(null, null)).toBe(false);
  });

  it('ignores designations that are not Bayer', () => {
    expect(reached(null, 300)).toBe(false);
  });
});

describe('unionIv27aBayer', () => {
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

describe('the § 2 disposition gate', () => {
  const tsv = [
    'proper\tclass\thip\thd',
    "Kapteyn's Star\tdiscovery-designation\t24186\t33793",
    'Ross 248\tdiscovery-designation',
    'p Eridani\tlatin-bayer\t\t10361',
  ].join('\n') + '\n';

  it('keys a short row the same way the spine side keys it', () => {
    expect(parseDispositionKeys(tsv)).toEqual(new Set([
      spineProperKey("Kapteyn's Star", '24186', '33793'),
      spineProperKey('Ross 248', '', ''),
      spineProperKey('p Eridani', '', '10361'),
    ]));
  });

  it('fails an unmatched proper missing from the file, and a stale row', () => {
    const disposed = parseDispositionKeys(tsv);
    const unmatched = new Set([
      spineProperKey('Ross 248', '', ''),
      spineProperKey('Vega', '91262', '172167'),
    ]);
    expect(diffDispositions(unmatched, disposed)).toEqual({
      missing: [spineProperKey('Vega', '91262', '172167')],
      stale: [
        spineProperKey("Kapteyn's Star", '24186', '33793'),
        spineProperKey('p Eridani', '', '10361'),
      ],
    });
  });

  it('passes on exact set equality', () => {
    expect(diffDispositions(parseDispositionKeys(tsv), parseDispositionKeys(tsv)))
      .toEqual({ missing: [], stale: [] });
  });
});

describe('sortDesignations', () => {
  it('orders rows independently of input order', () => {
    const rows = [
      desig({ letter: 'β', dc: 'Cyg', hd: 2 }),
      desig({ letter: 'α', dc: 'Cyg', hd: 1 }),
      desig({ kind: 'gould', letter: null, num: 4, dc: 'Cet' }),
    ];
    const forwards = sortDesignations(rows).sorted;
    const backwards = sortDesignations([...rows].reverse()).sorted;
    expect(forwards).toEqual(backwards);
    expect(forwards.map((d) => d.letter ?? String(d.num))).toEqual(['α', 'β', '4']);
  });

  it('counts rows that tie on every sorted field', () => {
    const dup = desig({ hd: 7 });
    expect(sortDesignations([dup, { ...dup }, desig({ hd: 8 })]))
      .toMatchObject({ duplicateRows: 1 });
  });
});

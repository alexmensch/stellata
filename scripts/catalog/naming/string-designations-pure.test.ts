import { describe, expect, it } from 'vitest';

import {
  buildStringDesignationIndex, expandSimbadIdent, identAttests, parseEponyms, parseNameDrops,
  stringDesignationFailures, type EponymRow, type NameDropRow, type ShortForm,
} from './string-designations-pure';

const FROM = { file: 'fixture.tsv', hint: 'h' };
const FORMS: ShortForm[] = [
  { simbadPrefix: '** STF', longPrefix: 'Struve' },
  { simbadPrefix: '** KR', longPrefix: 'Kruger' },
  { simbadPrefix: 'LAL', longPrefix: 'Lalande' },
  { simbadPrefix: 'NAME', longPrefix: '' },
];

describe('the readers', () => {
  it('reads a SIMBAD citation and a WGSN one', () => {
    expect(parseEponyms(
      'name\tclass\tkey\tsource\tcitation\tident\n'
      + 'Ross 128\tdiscovery-designation\thip:57548\tsimbad\t1847655\tRoss 128\n'
      + '82 G. Eri\tgould-designation\thd:20794\twgsn\t\t\n', FROM,
    )).toEqual([
      { name: 'Ross 128', class: 'discovery-designation', key: 'hip:57548', citation: { source: 'simbad', oid: 1847655, ident: 'Ross 128' } },
      { name: '82 G. Eri', class: 'gould-designation', key: 'hd:20794', citation: { source: 'wgsn' } },
    ]);
  });

  it('refuses a key that names no identifier kind', () => {
    expect(() => parseNameDrops('name\tclass\tkey\tevidence\nX\tunattributed\ttyc:1\twhy\n', FROM))
      .toThrow(/fixture\.tsv:2: key/);
  });

  it('refuses a dropped name with no evidence', () => {
    expect(() => parseNameDrops('name\tclass\tkey\tevidence\nX\tunattributed\thd:1\t\n', FROM))
      .toThrow(/fixture\.tsv:2: evidence/);
  });
});

describe('identAttests', () => {
  it('spells a short form out and drops a class marker', () => {
    expect(expandSimbadIdent('LAL 21185', FORMS)).toBe('Lalande 21185');
    expect(expandSimbadIdent("NAME Kapteyn's star", FORMS)).toBe("Kapteyn's star");
    expect(expandSimbadIdent('V* GX And', FORMS)).toBeNull();
  });

  it('matches up to spacing and case', () => {
    expect(identAttests('** STF 2398A', 'Struve 2398 A', FORMS)).toBe(true);
    expect(identAttests("NAME Babcock's Star", "Babcock's star", FORMS)).toBe(true);
  });

  it('lets a system ident attest a name that carries no component letter, never another component', () => {
    expect(identAttests('** KR 60AB', 'Kruger 60', FORMS)).toBe(true);
    expect(identAttests('** STF 2398A', 'Struve 2398 B', FORMS)).toBe(false);
  });

  it('refuses a different number and an ident no short form covers', () => {
    expect(identAttests('LAL 21186', 'Lalande 21185', FORMS)).toBe(false);
    expect(identAttests('Ross 128', 'Ross 128', FORMS)).toBe(false);
  });
});

describe('the record join', () => {
  const ross: EponymRow = { name: 'Ross 128', class: 'discovery-designation', key: 'hip:57548', citation: { source: 'wgsn' } };
  const pEriA: NameDropRow = { name: 'p Eridani', class: 'latin-bayer', key: 'hd:10360' };
  const pEriB: NameDropRow = { name: 'p Eridani', class: 'latin-bayer', key: 'hd:10361' };
  const index = buildStringDesignationIndex([ross], [pEriA, pEriB]);

  it('reaches a record by any identifier it carries', () => {
    expect(index.of({ hd: null, hip: 57548, gaiaSourceId: '1' }).eponym).toBe(ross);
    expect(index.of({ hd: 10361, hip: 7751, gaiaSourceId: null }).drops).toEqual([pEriB]);
    expect(index.of({ hd: 1, hip: 2, gaiaSourceId: '3' })).toEqual({ eponym: null, drops: [] });
  });

  it('refuses two eponyms on one record', () => {
    const both = buildStringDesignationIndex([ross, { ...ross, name: 'Other', key: 'hd:5' }], []);
    expect(() => both.of({ hd: 5, hip: 57548, gaiaSourceId: null })).toThrow(/Other and Ross 128 reach one record/);
  });

  it('fails a row that reaches no record, two, or one the authority names', () => {
    const reach = new Map([[pEriA, { records: 2, iauNamed: 0 }], [pEriB, { records: 1, iauNamed: 1 }]]);
    expect(stringDesignationFailures([ross, pEriA, pEriB], reach)).toEqual([
      'Ross 128 (hip:57548) reaches 0 records, not 1',
      'p Eridani (hd:10360) reaches 2 records, not 1',
      'p Eridani (hd:10361) reaches a record the IAU WGSN names: delete the row',
    ]);
  });
});

import { describe, expect, it } from 'vitest';

import {
  buildWgsnIndex,
  diffDispositions,
  manifestNaming,
  membershipProperKey,
  parseProperDispositions,
  pickBayerRow,
  pickNameRow,
  routeDisposedProper,
  type ManifestNamingRow,
} from './wgsn-index-pure';
import { WGSN_NAMES } from './wgsn-names-tsv';
import type { DesignationRow } from './wgsn-tables-pure';

const FROM = { file: 'fixture.tsv', hint: 'h' };

const bayer = (over: Partial<DesignationRow>): DesignationRow => ({
  kind: 'bayer', letter: null, sup: null, num: null, dc: '', half: null,
  component: null, hip: null, hr: null, hd: null, source: 'nec', ...over,
});

const NAMES_HEADER = `${WGSN_NAMES.columns.join('\t')}\n`;

describe('the disposition reader', () => {
  it('reads a short row, its absent keys as null', () => {
    expect(parseProperDispositions(
      'proper\tclass\thip\thd\nRoss 128\tdiscovery-designation\t57548\t\nRoss 248\tdiscovery-designation\n', FROM,
    )).toEqual([
      { proper: 'Ross 128', disposition: 'discovery-designation', hip: 57548, hd: null },
      { proper: 'Ross 248', disposition: 'discovery-designation', hip: null, hd: null },
    ]);
  });

  it('refuses a class outside the routed set', () => {
    expect(() => parseProperDispositions('proper\tclass\thip\thd\nX\tfolk-name\t\t\n', FROM))
      .toThrow(/fixture\.tsv:2: class/);
  });
});

describe('the record-side join', () => {
  // NEC lists both p Eri rows against HIP 7751 and separates them only by
  // HR and HD, so a HIP-first join collapses A and B onto one record.
  const designations = [
    bayer({ letter: 'p', dc: 'Eri', component: 'A', hip: 7751, hr: 486, hd: 10360 }),
    bayer({ letter: 'p', dc: 'Eri', component: 'B', hip: 7751, hr: 487, hd: 10361 }),
  ];
  const index = buildWgsnIndex([], designations);

  it('resolves HR before HD before HIP', () => {
    expect(index.bayerOf({ hip: 7751, hd: 10360, hr: 486, proper: null })?.component)
      .toBe('A');
    expect(index.bayerOf({ hip: 7751, hd: 10361, hr: 487, proper: null })?.component)
      .toBe('B');
    expect(index.bayerOf({ hip: 7751, hd: 10361, hr: null, proper: null })?.component)
      .toBe('B');
  });

  it('falls back to the record\'s own printed name where no key reaches one', () => {
    // Albireo B's spine row is HD 183914 against the authority's 183913,
    // and the faints hosts Kaewkosin and Maru carry no identifier at all.
    const names = WGSN_NAMES.parse(
      NAMES_HEADER
      + 'Albireo B\t\t\t\t\t183913\t\t5.15\tnec\t7412\n',
    );
    const withNames = buildWgsnIndex(names, []);
    expect(withNames.nameOf({ hip: 95951, hd: 183914, hr: 7418, proper: 'Albireo B' }))
      .toMatchObject({ viaProper: true });
    expect(withNames.nameOf({ hip: 95951, hd: 183914, hr: 7418, proper: null }))
      .toBeNull();
  });
});

describe('pickers', () => {
  it('prefers the bare row: a lettered one names a component, not the star', () => {
    // γ Cen's keys carry γ Cen, γ Cen A and γ Cen B.
    const rows = [
      bayer({ letter: 'γ', dc: 'Cen', component: 'A' }),
      bayer({ letter: 'γ', dc: 'Cen', component: null }),
      bayer({ letter: 'γ', dc: 'Cen', component: 'B' }),
    ];
    expect(pickBayerRow(rows).component).toBeNull();
  });

  it('prefers a Greek glyph over the Latin overflow series', () => {
    // NEC hangs `y Cen B` on γ Cen's keys, and reading that as the star's
    // designation renamed γ Cen to `y Cen`.
    const rows = [
      bayer({ letter: 'y', dc: 'Cen', component: 'B' }),
      bayer({ letter: 'γ', dc: 'Cen' }),
    ];
    expect(pickBayerRow(rows).letter).toBe('γ');
  });

  it('prefers the superscripted row: the bare one names the pair', () => {
    // β Sco and β¹ Sco both key HIP 78820; the star is β¹ Sco.
    const rows = [bayer({ letter: 'β', dc: 'Sco' }), bayer({ letter: 'β', sup: 1, dc: 'Sco' })];
    expect(pickBayerRow(rows).sup).toBe(1);
  });

  it('prefers the bare NAME: a lettered one names a component of the star', () => {
    const rows = WGSN_NAMES.parse(
      NAMES_HEADER
      + 'Albireo A\t\t95947\t\t7417\t183912\t\t3.2\tnec\t7411\n'
      + 'Albireo\t\t95947\t\t7417\t183912\t\t3.08\tnec\t7410\n',
    );
    expect(pickNameRow(rows).name).toBe('Albireo');
  });
});

describe('disposition routing', () => {
  it('displays a discovery or catalogue designation as a string', () => {
    expect(routeDisposedProper('Ross 128', 'discovery-designation'))
      .toEqual({ eponym: 'Ross 128', alias: null });
    expect(routeDisposedProper('Cygnus X-1', 'catalogue-designation'))
      .toEqual({ eponym: 'Cygnus X-1', alias: null });
  });

  it('displays a Gould designation as a string too', () => {
    // The authority carries only one of the three (82 G. Eri) and both
    // paths render the identical form.
    expect(routeDisposedProper('268 G. Cet', 'gould-designation').eponym)
      .toBe('268 G. Cet');
  });

  it('keeps a displaced name searchable and nothing more', () => {
    expect(routeDisposedProper('Acrab B', 'component-letter'))
      .toEqual({ eponym: null, alias: 'Acrab B' });
    expect(routeDisposedProper('Deltoton', 'unattributed'))
      .toEqual({ eponym: null, alias: 'Deltoton' });
    // The Bayer tier renders `p Eri`; the full genitive AT-HYG printed is
    // not derivable from it.
    expect(routeDisposedProper('p Eridani', 'latin-bayer'))
      .toEqual({ eponym: null, alias: 'p Eridani' });
  });

  it('routes an undisposed proper nowhere — the authority names it', () => {
    expect(routeDisposedProper('Sirius', undefined))
      .toEqual({ eponym: null, alias: null });
  });
});

describe('the naming-authority disposition gate', () => {
  const disposed = new Set([
    membershipProperKey("Kapteyn's Star", 24186, 33793),
    membershipProperKey('Ross 248', null, null),
    membershipProperKey('p Eridani', null, 10361),
  ]);

  it('keys an absent number as an empty slot', () => {
    expect(membershipProperKey('p Eridani', null, 10361)).toBe('p Eridani||10361');
  });

  it('fails an unmatched proper missing from the file, and a stale row', () => {
    const unmatched = new Set([
      membershipProperKey('Ross 248', null, null),
      membershipProperKey('Vega', 91262, 172167),
    ]);
    expect(diffDispositions(unmatched, disposed)).toEqual({
      missing: [membershipProperKey('Vega', 91262, 172167)],
      stale: [
        membershipProperKey("Kapteyn's Star", 24186, 33793),
        membershipProperKey('p Eridani', null, 10361),
      ],
    });
  });

  it('passes on exact set equality', () => {
    expect(diffDispositions(disposed, new Set(disposed))).toEqual({ missing: [], stale: [] });
  });
});

describe('manifestNaming', () => {
  const manifestRow = (over: Partial<ManifestNamingRow>): ManifestNamingRow => ({
    proper: null, bayer: null, hip: null, hd: null, isSol: false, ...over,
  });
  const approved = buildWgsnIndex(
    WGSN_NAMES.parse(`${NAMES_HEADER}Vega\t\t91262\t\t7001\t172167\t\t0.03\tnec\t1\nUnurgunite\tNganurganity\t\t\t\t50\t\t\tnec\t2\n`),
    [],
  ).approvedNameKeys;
  const rows = [
    manifestRow({ proper: 'Vega', bayer: 'Alp', hip: 91262, hd: 172167 }),
    manifestRow({ proper: 'Nganurganity', hd: 50 }),
    manifestRow({ proper: 'Sol', isSol: true }),
    manifestRow({ proper: 'Ross 248' }),
    manifestRow({ bayer: 'Bet', hd: 7 }),
  ];

  it('matches aliases, skips Sol, and counts Bayer rows the table reaches', () => {
    const result = manifestNaming(
      rows, approved, [bayer({ hip: 91262 })], [{ proper: 'Ross 248', hip: null, hd: null }],
    );
    expect(result).toEqual({
      counts: {
        membershipPropers: 3,
        membershipProperMatched: 2,
        membershipProperResiduals: 1,
        membershipBayerRows: 2,
        membershipBayerRowsCovered: 1,
      },
      missing: [],
      stale: [],
    });
  });

  it('names an undisposed residual and a disposition the authority now covers', () => {
    const { missing, stale } = manifestNaming(
      rows, approved, [], [{ proper: 'Vega', hip: 91262, hd: 172167 }],
    );
    expect({ missing, stale }).toEqual({
      missing: [membershipProperKey('Ross 248', null, null)],
      stale: [membershipProperKey('Vega', 91262, 172167)],
    });
  });
});

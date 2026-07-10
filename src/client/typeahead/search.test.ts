import { describe, it, expect } from 'vitest';
import {
  splitBayer,
  formatBayerDisplay,
  superscript,
  buildBayerLabels,
  buildBayerMap,
  buildSpectralMap,
  buildSearchIndex,
  buildStarLabels,
  formatGcvsDesignation,
  buildGcvsLabels,
  type SearchEntry,
} from './search';
import { makeEmptyCatalog } from '../loaders/catalog-mock';

describe('search / splitBayer', () => {
  it('parses a Latin 3-letter Bayer with no suffix', () => {
    expect(splitBayer('Alp')).toEqual({ letter3: 'Alp', suffix: '' });
    expect(splitBayer('Bet')).toEqual({ letter3: 'Bet', suffix: '' });
    expect(splitBayer('Ome')).toEqual({ letter3: 'Ome', suffix: '' });
  });

  it('parses a Bayer with -1 / -2 component suffix', () => {
    expect(splitBayer('Alp-1')).toEqual({ letter3: 'Alp', suffix: '-1' });
    expect(splitBayer('Tau-2')).toEqual({ letter3: 'Tau', suffix: '-2' });
  });

  it('parses 2-letter Bayer (Mu, Nu, Xi, Pi)', () => {
    // The Greek letters whose canonical 3-letter abbreviation is shorter
    // than 3 chars must still parse — they appear in source data verbatim.
    expect(splitBayer('Mu')).toEqual({ letter3: 'Mu', suffix: '' });
    expect(splitBayer('Nu')).toEqual({ letter3: 'Nu', suffix: '' });
    expect(splitBayer('Xi')).toEqual({ letter3: 'Xi', suffix: '' });
    expect(splitBayer('Pi')).toEqual({ letter3: 'Pi', suffix: '' });
  });

  it('normalises mixed-case input', () => {
    // Canonical capitalisation: first letter upper, rest lower.
    expect(splitBayer('alp')).toEqual({ letter3: 'Alp', suffix: '' });
    expect(splitBayer('ALP')).toEqual({ letter3: 'Alp', suffix: '' });
    expect(splitBayer('aLp')).toEqual({ letter3: 'Alp', suffix: '' });
  });

  it('returns null for unknown Greek letters', () => {
    // The dictionary only knows the canonical 24 — anything else is data
    // we don't recognise and shouldn't fabricate a glyph for.
    expect(splitBayer('Foo')).toBeNull();
    expect(splitBayer('Xxx')).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(splitBayer('')).toBeNull();
    expect(splitBayer('Alp-')).toBeNull(); // trailing dash with no digit
    expect(splitBayer('Alp-12')).toBeNull(); // multi-digit suffix not supported
    expect(splitBayer('Alp 1')).toBeNull(); // space-separated suffix
  });
});

describe('search / superscript', () => {
  it('maps decimal digits to unicode superscript glyphs', () => {
    expect(superscript('1')).toBe('¹');
    expect(superscript('2')).toBe('²');
    expect(superscript('0')).toBe('⁰');
    expect(superscript('9')).toBe('⁹');
  });

  it('maps multi-digit strings character-by-character', () => {
    expect(superscript('12')).toBe('¹²');
    expect(superscript('420')).toBe('⁴²⁰');
  });

  it('passes through non-digit characters unchanged', () => {
    // Defensive — caller should only pass digits, but the helper must not
    // corrupt unexpected input.
    expect(superscript('a')).toBe('a');
  });

  it('returns empty string for empty input', () => {
    expect(superscript('')).toBe('');
  });
});

describe('search / formatBayerDisplay', () => {
  it('formats a basic Bayer letter as Greek glyph + constellation code', () => {
    expect(formatBayerDisplay('Alp', 'Cen')).toBe('α Cen');
    expect(formatBayerDisplay('Bet', 'Ori')).toBe('β Ori');
  });

  it('attaches a unicode superscript for component suffixes', () => {
    // α¹ Cen (Rigil Kentaurus) — the superscript is what visually
    // distinguishes the A and B components of a Bayer-multiple system.
    expect(formatBayerDisplay('Alp-1', 'Cen')).toBe('α¹ Cen');
    expect(formatBayerDisplay('Tau-2', 'Cet')).toBe('τ² Cet');
  });

  it('falls through to raw-Bayer + code when the letter is unknown', () => {
    // Unknown letters preserve the raw input so the user can still see
    // *something*, rather than swallowing the data silently.
    expect(formatBayerDisplay('Xxx', 'Cen')).toBe('Xxx Cen');
  });
});

describe('search / buildBayerLabels', () => {
  it('returns multiple search forms for a Bayer star', () => {
    const labels = buildBayerLabels('Alp', 'Cen', 'Centauri');
    // Forms users actually type: full Latin name, 3-letter abbrev, Greek glyph,
    // both with code and full constellation name.
    expect(labels).toContain('Alpha Cen');
    expect(labels).toContain('Alpha Centauri');
    expect(labels).toContain('Alp Cen');
    expect(labels).toContain('α Cen');
    expect(labels).toContain('α Centauri');
  });

  it('includes the "Alf Cen" alternate spelling for Alpha only', () => {
    // "Alf" is a common transliteration that some users will type for Alpha.
    // No equivalent transliteration is included for Beta/Gamma/etc.
    const alpha = buildBayerLabels('Alp', 'Cen', 'Centauri');
    expect(alpha).toContain('Alf Cen');
    expect(alpha).toContain('Alf Centauri');

    const beta = buildBayerLabels('Bet', 'Cen', 'Centauri');
    expect(beta.find(l => l.startsWith('Alf'))).toBeUndefined();
  });

  it('drops the component-suffix from search forms', () => {
    // The "-1/-2" suffix exists for binary disambiguation; in search we
    // want users to find the system from "Alpha Cen" without typing the
    // component number. Both A and B share the same labels and surface
    // together in results.
    const aLabels = buildBayerLabels('Alp-1', 'Cen', 'Centauri');
    const noSuffix = buildBayerLabels('Alp', 'Cen', 'Centauri');
    // Must be identical: same lookup keys for both components.
    expect(aLabels.sort()).toEqual(noSuffix.sort());
  });

  it('returns deduped labels (Set semantics)', () => {
    const labels = buildBayerLabels('Alp', 'Cen', 'Centauri');
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('falls back to raw-Bayer + code when the letter is unknown', () => {
    // Unparseable Bayer strings still produce one label so the star isn't
    // unfindable, even though we can't generate the variants.
    expect(buildBayerLabels('Xxx', 'Cen', 'Centauri')).toEqual(['Xxx Cen']);
  });
});

describe('search / buildBayerMap', () => {
  it('produces an entry per Bayer-tagged star with parseable letter and constellation', () => {
    const raw: SearchEntry[] = [
      { i: 0, b: 'Alp', c: 1 },
      { i: 1, b: 'Bet', c: 2 },
    ];
    const map = buildBayerMap(raw);
    expect(map.size).toBe(2);
    expect(map.get(0)).toEqual({ greek: 'α', suffix: '', conIdx: 1 });
    expect(map.get(1)).toEqual({ greek: 'β', suffix: '', conIdx: 2 });
  });

  it('encodes -1/-2 component suffix as a unicode superscript', () => {
    const raw: SearchEntry[] = [{ i: 0, b: 'Alp-1', c: 5 }];
    const map = buildBayerMap(raw);
    expect(map.get(0)).toEqual({ greek: 'α', suffix: '¹', conIdx: 5 });
  });

  it('skips entries with no Bayer string', () => {
    const raw: SearchEntry[] = [
      { i: 0, p: 'Sirius', c: 1 },
      { i: 1, b: 'Alp', c: 2 },
    ];
    const map = buildBayerMap(raw);
    expect(map.has(0)).toBe(false);
    expect(map.has(1)).toBe(true);
  });

  it('skips entries with no constellation (chart label needs both)', () => {
    const raw: SearchEntry[] = [
      { i: 0, b: 'Alp', c: 255 },
      { i: 1, b: 'Bet' /* no c */ },
    ];
    expect(buildBayerMap(raw).size).toBe(0);
  });

  it('skips entries whose Bayer letter is unknown', () => {
    const raw: SearchEntry[] = [
      { i: 0, b: 'Xxx', c: 1 },
      { i: 1, b: 'Alp', c: 1 },
    ];
    const map = buildBayerMap(raw);
    expect(map.has(0)).toBe(false);
    expect(map.has(1)).toBe(true);
  });
});

describe('search / buildSpectralMap', () => {
  it('keeps only entries with a spectral string', () => {
    const raw: SearchEntry[] = [
      { i: 0, s: 'G2 V' },
      { i: 1, s: 'M1.5Iab-b' },
      { i: 2, p: 'NoSpect' },
    ];
    const map = buildSpectralMap(raw);
    expect(map.size).toBe(2);
    expect(map.get(0)).toBe('G2 V');
    expect(map.get(1)).toBe('M1.5Iab-b');
    expect(map.has(2)).toBe(false);
  });

  it('preserves the source spectral string verbatim', () => {
    // Composites and ranges (e.g. 'K0III+K7V', 'M1.5Iab-b') must round-
    // trip through the map without any normalisation — the tooltip shows
    // the catalog's exact classification.
    const raw: SearchEntry[] = [{ i: 0, s: 'K0III+K7V' }];
    expect(buildSpectralMap(raw).get(0)).toBe('K0III+K7V');
  });

  it('returns an empty map when no entries carry spectral info', () => {
    const raw: SearchEntry[] = [{ i: 0, p: 'A' }, { i: 1 }];
    expect(buildSpectralMap(raw).size).toBe(0);
  });
});

describe('search / formatGcvsDesignation', () => {
  it('strips the V-number zero-padding GCVS stores', () => {
    expect(formatGcvsDesignation('V0645 Cen')).toBe('V645 Cen');
    expect(formatGcvsDesignation('V1500 Cyg')).toBe('V1500 Cyg');
    expect(formatGcvsDesignation('V0404 Cyg')).toBe('V404 Cyg');
  });

  it('leaves letter-sequence names untouched', () => {
    expect(formatGcvsDesignation('R CrB')).toBe('R CrB');
    expect(formatGcvsDesignation('VY CMa')).toBe('VY CMa');
    expect(formatGcvsDesignation('RR Lyr')).toBe('RR Lyr');
  });
});

describe('search / buildGcvsLabels', () => {
  it('emits the abbreviated form plus a con-name-expanded variant', () => {
    expect(buildGcvsLabels('V0645 Cen', 'Centauri')).toEqual([
      'V645 Cen',
      'V645 Centauri',
    ]);
    expect(buildGcvsLabels('VY CMa', 'Canis Majoris')).toEqual([
      'VY CMa',
      'VY Canis Majoris',
    ]);
  });

  it('emits only the abbreviated form when no constellation name is known', () => {
    expect(buildGcvsLabels('R CrB', '')).toEqual(['R CrB']);
  });
});

describe('search / buildSearchIndex', () => {
  const CONS = [
    { code: 'Cyg', name: 'Cygni' },
    { code: 'Ori', name: 'Orionis' },
    { code: 'CMa', name: 'Canis Majoris' },
  ];

  it('emits fuzzy GCVS labels, taking the designation as primary when unnamed', () => {
    // VY CMa carries no proper/Bayer/Flamsteed — its display + fuzzy labels
    // come from the GCVS designation alone.
    const raw: SearchEntry[] = [{ i: 7, g: 'VY CMa', c: 2 }];
    const { fuzzyEntries } = buildSearchIndex(raw, CONS);
    const entries = fuzzyEntries.filter((e) => e.index === 7);
    expect(entries.map((e) => e.label).sort()).toEqual([
      'VY CMa',
      'VY Canis Majoris',
    ]);
    expect(new Set(entries.map((e) => e.primary))).toEqual(new Set(['VY CMa']));
  });

  it('keeps the proper-name primary when a GCVS variable is also named', () => {
    const raw: SearchEntry[] = [{ i: 8, p: 'Betelgeuse', g: 'alf Ori', c: 1 }];
    const { fuzzyEntries } = buildSearchIndex(raw, CONS);
    const gcvs = fuzzyEntries.filter((e) => e.index === 8 && e.label.startsWith('alf'));
    expect(gcvs.length).toBeGreaterThan(0);
    expect(new Set(gcvs.map((e) => e.primary))).toEqual(new Set(['Betelgeuse']));
  });

  it('indexes every component of a Flamsteed multiple under one key', () => {
    // 61 Cyg A + B share flam=61, con=Cyg. The map must hold both, so an
    // exact "61 cyg" query returns each rather than collapsing to the last.
    const raw: SearchEntry[] = [
      { i: 10, p: '61 Cyg A', f: 61, c: 0 },
      { i: 11, p: '61 Cyg B', f: 61, c: 0 },
    ];
    const { flamMap } = buildSearchIndex(raw, CONS);
    const hits = flamMap.get('61 cyg');
    expect(hits?.map((e) => e.index)).toEqual([10, 11]);
    expect(hits?.map((e) => e.primary)).toEqual(['61 Cyg A', '61 Cyg B']);
  });

  it('keys Flamsteed under both the code and full constellation name', () => {
    const raw: SearchEntry[] = [{ i: 10, p: '61 Cyg A', f: 61, c: 0 }];
    const { flamMap } = buildSearchIndex(raw, CONS);
    expect(flamMap.get('61 cyg')?.[0].index).toBe(10);
    expect(flamMap.get('61 cygni')?.[0].index).toBe(10);
  });

  it('falls back to the canonical designation for anonymous Flamsteed stars', () => {
    // No proper name, no Bayer — the display must be "58 Ori", never the
    // raw typed query. Such stars are indexed for exact lookup only, not
    // pushed into the fuzzy corpus.
    const raw: SearchEntry[] = [{ i: 5, f: 58, c: 1 }];
    const { flamMap, fuzzyEntries } = buildSearchIndex(raw, CONS);
    expect(flamMap.get('58 ori')?.[0].primary).toBe('58 Ori');
    expect(fuzzyEntries.some((e) => e.index === 5)).toBe(false);
  });

  it('shares one display form across a star\'s fuzzy labels', () => {
    const raw: SearchEntry[] = [{ i: 3, p: 'Keid', b: 'Omi-2', f: 40, c: 1 }];
    const { fuzzyEntries } = buildSearchIndex(raw, CONS);
    const primaries = new Set(fuzzyEntries.filter((e) => e.index === 3).map((e) => e.primary));
    expect([...primaries]).toEqual(['Keid (ο² Ori)']);
  });

  it('populates the numeric-ID direct-lookup maps', () => {
    const raw: SearchEntry[] = [
      { i: 0, hip: 91262, hd: 172167, hr: 7001 },
      { i: 1, gl: 'Gl 559A' },
    ];
    const { hipMap, hdMap, hrMap, glMap } = buildSearchIndex(raw, CONS);
    expect(hipMap.get(91262)).toBe(0);
    expect(hdMap.get(172167)).toBe(0);
    expect(hrMap.get(7001)).toBe(0);
    expect(glMap.get('559a')).toBe(1);
  });

  it('normalizes any Gl/GJ/Gliese prefix to the same lookup key', () => {
    // AT-HYG stores "Gl 551", but "GJ 551" / "Gliese 551" must resolve the
    // same star — the prefix is stripped so all three land on key "551".
    const raw: SearchEntry[] = [
      { i: 0, gl: 'Gl 551' },
      { i: 1, gl: 'GJ 9581' },
      { i: 2, gl: 'Gliese 411' },
    ];
    const { glMap } = buildSearchIndex(raw, CONS);
    expect(glMap.get('551')).toBe(0);
    expect(glMap.get('9581')).toBe(1);
    expect(glMap.get('411')).toBe(2);
  });
});

describe('search / buildStarLabels', () => {
  it('prepends a prefix to the bare-numeric HIP/HD/HR identifiers', () => {
    const raw: SearchEntry[] = [
      { i: 0, hip: 91262 },
      { i: 1, hd: 172167 },
      { i: 2, hr: 7001 },
    ];
    const labels = buildStarLabels(makeEmptyCatalog(3), raw);
    expect(labels.get(0)).toBe('HIP 91262');
    expect(labels.get(1)).toBe('HD 172167');
    expect(labels.get(2)).toBe('HR 7001');
  });

  it('uses the Gliese designation verbatim — the prefix is already in the field', () => {
    const raw: SearchEntry[] = [
      { i: 0, gl: 'Gl 195A' },
      { i: 1, gl: 'GJ 9581' },
    ];
    const labels = buildStarLabels(makeEmptyCatalog(2), raw);
    expect(labels.get(0)).toBe('Gl 195A');
    expect(labels.get(1)).toBe('GJ 9581');
  });

  it('labels an otherwise-anonymous variable by its GCVS designation, ranked below HIP', () => {
    // VY CMa has only HIP/HD in AT-HYG; without the GCVS tier it would read
    // "HIP 35793". The designation is the recognisable name, so it wins.
    const raw: SearchEntry[] = [{ i: 0, g: 'V0645 Cen', hip: 70890 }];
    const labels = buildStarLabels(makeEmptyCatalog(1), raw);
    expect(labels.get(0)).toBe('V645 Cen');
  });
});

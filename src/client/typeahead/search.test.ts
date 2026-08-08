import { describe, it, expect } from 'vitest';
import {
  splitBayer,
  formatBayerDisplay,
  superscript,
  buildBayerLabels,
  buildComponentLabels,
  buildBayerMap,
  buildSpectralMap,
  buildSearchIndex,
  buildStarLabels,
  formatGcvsDesignation,
  buildGcvsLabels,
  createSearchRunner,
  resolveEntryTarget,
  starDesignations,
  type FuzzyEntry,
  type SearchEntry,
} from './search';
import type { Stellata } from '../stellata';
import { makeEmptyCatalog } from '../loaders/catalog-mock';
import { KIND_ROSTER, type KindModules } from '../kinds/kind-modules';
import type { KindSearchEntry, ObjectKindModule } from '../kinds/kind-module';
import type { TargetKind } from '../camera/focus/focus-target';

/** KindModules record whose only module answers `searchEntries` for one
 *  kind — the roster-driven corpus path under test. */
function kindsWith(kind: TargetKind, entries: KindSearchEntry[]): KindModules {
  return Object.fromEntries(
    KIND_ROSTER.map((k) => [
      k,
      k === kind
        ? ({ kind, searchEntries: () => entries } as unknown as ObjectKindModule)
        : null,
    ]),
  ) as unknown as KindModules;
}

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

describe('search / buildComponentLabels', () => {
  it('expands "<system> <letter>" across every Bayer + Flamsteed form', () => {
    const primary: SearchEntry = { i: 0, b: 'Alp-1', f: 21, c: 0 };
    const labels = buildComponentLabels(primary, 'Cen', 'Centauri', 'C');
    expect(labels).toContain('Alpha Cen C');
    expect(labels).toContain('Alpha Centauri C');
    expect(labels).toContain('α Cen C');
    expect(labels).toContain('Alf Cen C');
    expect(labels).toContain('21 Cen C');
    expect(labels).toContain('21 Centauri C');
  });

  it('drops the primary component suffix — the base is the system, not α¹', () => {
    const primary: SearchEntry = { i: 0, b: 'Alp-1', c: 0 };
    const labels = buildComponentLabels(primary, 'Cen', 'Centauri', 'B');
    expect(labels).not.toContain('α¹ Cen B');
    expect(labels).toContain('α Cen B');
  });

  it('returns nothing when the primary has no Bayer or Flamsteed', () => {
    // A proper-name-only primary yields no base: "Rigil Kentaurus C" would be
    // wrong (the proper names component A, not the system).
    expect(buildComponentLabels({ i: 0, p: 'Sol', c: 0 }, 'Cen', 'Centauri', 'B')).toEqual([]);
  });
});

describe('search / component-letter aliases', () => {
  const CONS = [{ code: 'Cen', name: 'Centaurus' }];
  // α Cen: Rigil (A) carries the Bayer; Toliman (B) and Proxima (C) reference
  // it via cp. Proxima has no Bayer of its own — its aliases come from α Cen.
  const raw: SearchEntry[] = [
    { i: 0, p: 'Rigil Kentaurus', b: 'Alp-1', c: 0, cl: 'A', cp: 0 },
    { i: 1, p: 'Toliman', b: 'Alp-2', c: 0, cl: 'B', cp: 0 },
    { i: 2, p: 'Proxima Centauri', c: 0, cl: 'C', cp: 0 },
  ];

  it('indexes "<system> <letter>" aliases against the component record', () => {
    const { fuzzyEntries } = buildSearchIndex(raw, CONS);
    const cLabels = fuzzyEntries.filter((e) => e.index === 2).map((e) => e.label);
    expect(cLabels).toContain('α Cen C');
    expect(cLabels).toContain('Alpha Centaurus C');
    expect(cLabels).toContain('Alf Cen C');
    // The dropdown display falls through to the component's own name.
    expect(fuzzyEntries.find((e) => e.index === 2 && e.label === 'α Cen C')?.primary)
      .toBe('Proxima Centauri');
  });

  it('resolves the acceptance queries to the correct components end-to-end', () => {
    const catalog = {
      ...makeEmptyCatalog(3),
      constellations: CONS,
      constellation: Float32Array.from([0, 0, 0]),
      names: new Map([[0, 'Rigil Kentaurus'], [1, 'Toliman'], [2, 'Proxima Centauri']]),
    };
    const run = createSearchRunner(catalog, raw);
    const top = (q: string) => run(q)[0]?.index;
    expect(top('Alpha Centauri C')).toBe(2);
    expect(top('α Cen C')).toBe(2);
    expect(top('Alf Cen C')).toBe(2);
    expect(top('Alpha Cen A')).toBe(0);
    expect(top('Alpha Cen B')).toBe(1);
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
    expect(map.get(0)).toEqual({ greek: 'α', suffix: '' });
    expect(map.get(1)).toEqual({ greek: 'β', suffix: '' });
  });

  it('encodes -1/-2 component suffix as a unicode superscript', () => {
    const raw: SearchEntry[] = [{ i: 0, b: 'Alp-1', c: 5 }];
    const map = buildBayerMap(raw);
    expect(map.get(0)).toEqual({ greek: 'α', suffix: '¹' });
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

  it('skips entries with no constellation (a Bayer letter needs one)', () => {
    const raw: SearchEntry[] = [
      { i: 0, b: 'Alp', c: 255 },
      { i: 1, b: 'Bet' /* no c */ },
    ];
    expect(buildBayerMap(raw).size).toBe(0);
  });

  it('takes the designation constellation over the positional one', () => {
    // ρ Aql's shape: positionally in Delphinus, designated in Aquila. The
    // glyph is the same either way, but the gate must read the field the
    // Bayer letter belongs to.
    const raw: SearchEntry[] = [
      { i: 0, b: 'Rho', c: 31, dc: 3 },
      { i: 1, b: 'Alp', c: 255, dc: 3 },
    ];
    const map = buildBayerMap(raw);
    expect(map.get(0)).toEqual({ greek: 'ρ', suffix: '' });
    expect(map.has(1)).toBe(true);
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
    expect(buildGcvsLabels('V0645 Cen', 'Cen', 'Centauri')).toEqual([
      'V645 Cen',
      'V645 Centauri',
    ]);
    expect(buildGcvsLabels('VY CMa', 'CMa', 'Canis Majoris')).toEqual([
      'VY CMa',
      'VY Canis Majoris',
    ]);
  });

  it('emits only the abbreviated form when no constellation name is known', () => {
    expect(buildGcvsLabels('R CrB', '', '')).toEqual(['R CrB']);
  });

  // 6,079 of the 14,148 GCVS-named entries end in a serial or a field number
  // rather than an abbreviation. Rewriting that token invented designations
  // that do not exist, in constellations the number has nothing to do with.
  it('never expands a trailing token that is not the constellation code', () => {
    expect(buildGcvsLabels('NSV 04199', 'Lup', 'Lupi')).toEqual(['NSV 04199']);
    // The V-number padding strip is anchored at the start of the designation,
    // so a Magellanic field number keeps its zeros — one label either way.
    expect(buildGcvsLabels('LMC V0471', 'Dor', 'Doradus')).toEqual(['LMC V0471']);
    expect(buildGcvsLabels('SMC V0018', 'Tuc', 'Tucanae')).toEqual(['SMC V0018']);
    // A component letter fused onto the abbreviation is not the abbreviation:
    // the expansion this used to emit ("EQ Pegasi") dropped the component.
    expect(buildGcvsLabels('EQ PegA', 'Peg', 'Pegasi')).toEqual(['EQ PegA']);
  });

  it('matches the abbreviation case-insensitively', () => {
    expect(buildGcvsLabels('R crb', 'CrB', 'Coronae Borealis')).toEqual([
      'R crb',
      'R Coronae Borealis',
    ]);
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

  it('builds designations from dc while the dropdown context line stays positional', () => {
    // ρ Aql: positionally in Delphinus (byte 34), designated in Aquila. Every
    // alias must be Aquila's; the row's constellation line must read
    // Delphinus, which is where the star actually is.
    const CONS_RHO = [
      { code: 'Aql', name: 'Aquila' },
      { code: 'Del', name: 'Delphinus' },
    ];
    const raw: SearchEntry[] = [{ i: 0, b: 'Rho', f: 67, c: 1, dc: 0 }];
    const { fuzzyEntries, flamMap } = buildSearchIndex(raw, CONS_RHO);
    expect(fuzzyEntries.map((e) => e.label).sort())
      .toEqual(['67 Aql', '67 Aquila', 'Rho Aql', 'Rho Aquila', 'ρ Aql', 'ρ Aquila']);
    expect(flamMap.get('67 aql')?.[0].index).toBe(0);
    expect(flamMap.get('67 del')).toBeUndefined();
    expect(new Set(fuzzyEntries.map((e) => e.displayCon))).toEqual(new Set(['Delphinus']));
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

  it('renders the display label against the designation constellation', () => {
    const catalog = makeEmptyCatalog(1);
    catalog.constellations = [{ code: 'Aql', name: 'Aquila' }, { code: 'Del', name: 'Delphinus' }];
    const raw: SearchEntry[] = [{ i: 0, f: 67, c: 1, dc: 0 }];
    expect(buildStarLabels(catalog, raw).get(0)).toBe('67 Aql');
  });

  it('labels an otherwise-anonymous variable by its GCVS designation, in preference to HIP', () => {
    // VY CMa has only HIP/HD in AT-HYG; without the GCVS tier it would read
    // "HIP 35793". The designation is the recognisable name, so it wins.
    const raw: SearchEntry[] = [{ i: 0, g: 'V0645 Cen', hip: 70890 }];
    const labels = buildStarLabels(makeEmptyCatalog(1), raw);
    expect(labels.get(0)).toBe('V645 Cen');
  });
});

describe('search / starDesignations', () => {
  const constellations = [{ code: 'Lyr' }];

  it('lists every designation tier in order, Gaia last', () => {
    const entry: SearchEntry = {
      i: 0, p: 'Vega', b: 'Alp', f: 3, c: 0, g: 'V0473 Lyr',
      hr: 7001, hd: 172167, hip: 91262, gl: 'Gl 721',
    };
    expect(starDesignations(entry, constellations, 123n)).toEqual([
      'Vega', 'α Lyr', '3 Lyr', 'V473 Lyr',
      'HR 7001', 'HD 172167', 'HIP 91262', 'Gl 721', 'Gaia DR3 123',
    ]);
  });

  it('skips absent fields and the Gaia sentinel', () => {
    const entry: SearchEntry = { i: 0, hd: 1 };
    expect(starDesignations(entry, constellations, 0n)).toEqual(['HD 1']);
  });

  it('skips a Bayer-form GCVS designation (already covered by the real Bayer)', () => {
    const entry: SearchEntry = { i: 0, p: 'Algol', b: 'Bet', c: 0, g: 'bet Lyr', hip: 14576 };
    // Fixture constellation is Lyr; the point is the lowercase Greek
    // first token, which duplicates the β display form.
    expect(starDesignations(entry, constellations, 0n)).toEqual([
      'Algol', 'β Lyr', 'HIP 14576',
    ]);
  });

  it('keeps uppercase GCVS letter-sequence designations (not Bayer forms)', () => {
    const entry: SearchEntry = { i: 0, g: 'MU Lyr' };
    expect(starDesignations(entry, constellations, 0n)).toEqual(['MU Lyr']);
  });

  it('takes the designation constellation over the positional one', () => {
    const entry: SearchEntry = { i: 0, b: 'Rho', f: 67, c: 1, dc: 0, hip: 99742 };
    expect(starDesignations(entry, [{ code: 'Aql' }, { code: 'Del' }], 0n))
      .toEqual(['ρ Aql', '67 Aql', 'HIP 99742']);
  });

  it('drops Bayer/Flamsteed forms when the constellation is unknown', () => {
    const entry: SearchEntry = { i: 0, b: 'Alp', f: 3, hip: 5 };
    expect(starDesignations(entry, constellations, 0n)).toEqual(['HIP 5']);
  });
});

describe('search / Local Group entries', () => {
  const catalog = { ...makeEmptyCatalog(0), constellations: [], names: new Map() };
  // The lg module emits one row per display name / catalog alias, with a
  // type-and-distance secondary line (lg-module.test.ts pins the
  // emission; these pin the runner over that row shape).
  const kinds = kindsWith('lg', [
    { index: 0, label: 'M31', primary: 'M31', displayCon: 'Spiral galaxy · 776 kpc' },
    { index: 0, label: 'Andromeda Galaxy', primary: 'M31', displayCon: 'Spiral galaxy · 776 kpc' },
    { index: 0, label: 'NGC 224', primary: 'M31', displayCon: 'Spiral galaxy · 776 kpc' },
    { index: 0, label: 'Messier 31', primary: 'M31', displayCon: 'Spiral galaxy · 776 kpc' },
    {
      index: 1,
      label: 'Sculptor Dwarf Spheroidal',
      primary: 'Sculptor Dwarf Spheroidal',
      displayCon: 'Dwarf spheroidal · 84 kpc',
    },
  ]);

  it('resolves aliases and display names to the same object with type + distance rows', () => {
    const run = createSearchRunner(catalog, [], kinds);
    for (const q of ['Andromeda Galaxy', 'NGC 224', 'Messier 31', 'M31']) {
      const hit = run(q)[0];
      expect(hit?.kind).toBe('lg');
      expect(hit?.index).toBe(0);
      expect(hit?.primary).toBe('M31');
      expect(hit?.displayCon).toBe('Spiral galaxy · 776 kpc');
    }
    const dwarf = run('Sculptor')[0];
    expect(dwarf?.kind).toBe('lg');
    expect(dwarf?.index).toBe(1);
    expect(dwarf?.displayCon).toBe('Dwarf spheroidal · 84 kpc');
  });

  it('dedupes multiple alias matches of one object to a single dropdown row', () => {
    const run = createSearchRunner(catalog, [], kinds);
    const rows = run('andromeda');
    expect(rows.filter((e) => e.kind === 'lg' && e.index === 0)).toHaveLength(1);
  });
});

describe('search / kind-module corpus rows (cloud shape)', () => {
  const catalog = { ...makeEmptyCatalog(0), constellations: [], names: new Map() };
  // The cloud module emits one row per display name / alias, all with the
  // cloud's Target idx — the multi-label-per-index shape the runner's
  // within-kind dedup exists for.
  const kinds = kindsWith('cloud', [
    { index: 0, label: 'Eagle Nebula', primary: 'Eagle Nebula', displayCon: 'Molecular cloud' },
    { index: 0, label: 'M16', primary: 'Eagle Nebula', displayCon: 'Molecular cloud' },
    { index: 0, label: 'NGC 6611', primary: 'Eagle Nebula', displayCon: 'Molecular cloud' },
    { index: 1, label: 'Taurus', primary: 'Taurus', displayCon: 'Molecular cloud' },
  ]);

  it('resolves the display name + every alias to the same cloud', () => {
    const run = createSearchRunner(catalog, [], kinds);
    for (const q of ['Eagle Nebula', 'M16', 'NGC 6611']) {
      const hit = run(q)[0];
      expect(hit?.kind, q).toBe('cloud');
      expect(hit?.index, q).toBe(0);
      expect(hit?.primary, q).toBe('Eagle Nebula');
      expect(hit?.displayCon, q).toBe('Molecular cloud');
    }
  });

  it('dedupes multiple alias matches of one cloud to a single dropdown row', () => {
    const run = createSearchRunner(catalog, [], kinds);
    expect(run('eagle').filter((e) => e.kind === 'cloud' && e.index === 0)).toHaveLength(1);
  });

  it('indexes an alias-less cloud by name alone', () => {
    const run = createSearchRunner(catalog, [], kinds);
    const hit = run('Taurus')[0];
    expect(hit?.kind).toBe('cloud');
    expect(hit?.index).toBe(1);
  });
});

describe('search / ranking tiers', () => {
  const CONS = [{ code: 'And', name: 'Andromeda' }];
  // Constellation-member stars whose expansion labels ("Gamma
  // Andromeda", "V366 Andromeda", "43 Andromeda") all contain the
  // constellation name — the rows that used to bury the galaxy.
  const raw: SearchEntry[] = [
    { i: 0, p: 'Almach', b: 'Gam-1', c: 0 },
    { i: 1, p: 'Alpheratz', b: 'Alp', c: 0 },
    { i: 2, g: 'V0366 And', c: 0 },
    { i: 3, p: 'Mirach', b: 'Bet', c: 0, f: 43 },
  ];
  const catalog = {
    ...makeEmptyCatalog(4),
    constellations: CONS,
    constellation: Float32Array.from([0, 0, 0, 0]),
    names: new Map([[0, 'Almach'], [1, 'Alpheratz'], [3, 'Mirach']]),
  };
  const lg = kindsWith('lg', [
    { index: 0, label: 'M31', primary: 'M31', displayCon: 'Galaxy · 776 kpc' },
    { index: 0, label: 'Andromeda Galaxy', primary: 'M31', displayCon: 'Galaxy · 776 kpc' },
    { index: 0, label: 'NGC 224', primary: 'M31', displayCon: 'Galaxy · 776 kpc' },
    {
      index: 1,
      label: 'Andromeda XIX Dwarf Spheroidal',
      primary: 'Andromeda XIX Dwarf Spheroidal',
      displayCon: 'Galaxy · 813 kpc',
    },
  ]);
  const run = createSearchRunner(catalog, raw, lg);

  it('tags constellation-expansion labels and only them', () => {
    const { fuzzyEntries } = buildSearchIndex(raw, CONS);
    const labelFor = (i: number, label: string) =>
      fuzzyEntries.find((e) => e.index === i && e.label === label);
    expect(labelFor(0, 'Gamma Andromeda')?.conExpansion).toBe(true);
    expect(labelFor(2, 'V366 Andromeda')?.conExpansion).toBe(true);
    expect(labelFor(3, '43 Andromeda')?.conExpansion).toBe(true);
    expect(labelFor(0, 'Gamma And')?.conExpansion).toBe(false);
    expect(labelFor(0, 'Almach')?.conExpansion).toBeFalsy();
  });

  it('"andromeda" surfaces the galaxy first, then the dwarf, before any member star', () => {
    const rows = run('andromeda');
    expect(rows[0]).toMatchObject({ kind: 'lg', index: 0, primary: 'M31' });
    expect(rows[1]).toMatchObject({ kind: 'lg', index: 1 });
    // Expansion rows survive, ranked behind the direct name matches.
    const firstStar = rows.findIndex((e) => e.kind === 'star');
    expect(firstStar).toBeGreaterThan(1);
  });

  it('an exact expansion query still puts the star first', () => {
    expect(run('gamma andromeda')[0]).toMatchObject({ kind: 'star', index: 0 });
    expect(run('V366 Andromeda')[0]).toMatchObject({ kind: 'star', index: 2 });
  });
});

describe('search / Sol planet entries', () => {
  const catalog = { ...makeEmptyCatalog(0), constellations: [], names: new Map(), solIndex: 0 };

  it('planet names resolve to planet-kind entries with the SOL_PLANETS index', () => {
    const run = createSearchRunner(catalog, []);
    const mars = run('mars')[0];
    expect(mars?.kind).toBe('planet');
    expect(mars?.index).toBe(3);
    expect(mars?.primary).toBe('Mars');
    expect(mars?.displayCon).toBe('Planet · Sol system');
    expect(run('jupiter')[0]?.index).toBe(4);
    expect(run('pluto')[0]?.index).toBe(8);
  });

  it('planet entries are omitted when the catalog has no Sol', () => {
    const noSol = { ...makeEmptyCatalog(0), constellations: [], names: new Map(), solIndex: -1 };
    const run = createSearchRunner(noSol, []);
    expect(run('mars')).toEqual([]);
  });
});

describe('search / resolveEntryTarget', () => {
  const catalog = { ...makeEmptyCatalog(0), constellations: [], names: new Map(), solIndex: 0 };
  const entry = (kind: FuzzyEntry['kind'], index: number): FuzzyEntry =>
    ({ kind, index, label: 'x', primary: 'x', displayCon: '' });

  it('passes non-planet kinds straight through', () => {
    const stellata = {} as Stellata;
    expect(resolveEntryTarget(stellata, catalog, entry('star', 7)))
      .toEqual({ kind: 'star', idx: 7 });
    expect(resolveEntryTarget(stellata, catalog, entry('lg', 2)))
      .toEqual({ kind: 'lg', idx: 2 });
  });

  it('translates planet entries through the body-field attach table', () => {
    const stellata = {
      planetField: { instanceIndexOf: (host: number, i: number) => (host === 0 ? i + 5 : null) },
    } as unknown as Stellata;
    expect(resolveEntryTarget(stellata, catalog, entry('planet', 2)))
      .toEqual({ kind: 'planet', idx: 7 });
  });

  it('returns null when the host body field has no attach entry', () => {
    const stellata = {
      planetField: { instanceIndexOf: () => null },
    } as unknown as Stellata;
    expect(resolveEntryTarget(stellata, catalog, entry('planet', 2))).toBeNull();
  });
});

describe('search / Gaia + SID direct dispatch', () => {
  const catalog = {
    ...makeEmptyCatalog(3),
    gaiaSourceId: BigUint64Array.from([0n, 4472832130942575872n, 0n]),
    sid: Uint32Array.from([11, 22, 33]),
  };
  const run = createSearchRunner(catalog, []);

  it.each([
    'Gaia DR3 4472832130942575872',
    'gaia 4472832130942575872',
    '4472832130942575872',
  ])('resolves %s to the record and echoes the canonical form', (q) => {
    const res = run(q);
    expect(res).toHaveLength(1);
    expect(res[0].index).toBe(1);
    expect(res[0].label).toBe('Gaia DR3 4472832130942575872');
  });

  it.each(['SID 33', 'sid #33'])('resolves %s to the record', (q) => {
    const res = run(q);
    expect(res).toHaveLength(1);
    expect(res[0].index).toBe(2);
    expect(res[0].label).toBe('SID #33');
  });

  it('unknown Gaia / SID ids return no results rather than fuzzy noise', () => {
    expect(run('Gaia DR3 9999999999999999999')).toEqual([]);
    expect(run('SID 999')).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import {
  classifyFromGspspec,
  classifyFromSimbad,
  resolveSpectDisplay,
  type LumClass,
  type MkLetter,
} from './spectral-classify';

const mk = (letter: MkLetter, subclass: number | null, lumClass: LumClass | null) =>
  ({ kind: 'mk', letter, subclass, lumClass });

describe('classifyFromSimbad', () => {
  it('returns null for empty / nullish input (caller falls through tier)', () => {
    expect(classifyFromSimbad('')).toBeNull();
    expect(classifyFromSimbad(null)).toBeNull();
    expect(classifyFromSimbad(undefined)).toBeNull();
  });

  it('maps the seven MK letters O..M to letters 0..6', () => {
    for (const [s, letter] of [['O5', 0], ['B5', 1], ['A5', 2], ['F5', 3], ['G5', 4], ['K5', 5], ['M5', 6]] as const) {
      expect(classifyFromSimbad(s)).toEqual(mk(letter, 5, null));
    }
  });

  it('parses a basic main-sequence type', () => {
    expect(classifyFromSimbad('G2V')).toEqual(mk(4, 2, 2));
  });

  it('parses giant and supergiant luminosity classes', () => {
    const lum = (s: string) => {
      const info = classifyFromSimbad(s);
      return info?.kind === 'mk' ? info.lumClass : info?.kind;
    };
    expect(lum('K0III')).toBe(4); // III
    expect(lum('M2II')).toBe(5);  // II
    expect(lum('B5IV')).toBe(3);  // IV
    expect(lum('M1Ia')).toBe(8);  // Ia
    expect(lum('M1Iab')).toBe(7); // Iab
    expect(lum('B0Ib')).toBe(6);  // Ib
    expect(lum('A0VII')).toBe(0); // VII (rare)
    expect(lum('K3VI')).toBe(1);  // VI (subdwarf)
    expect(lum('B5Ia+')).toBe(9); // Ia+ hypergiant
    expect(lum('M2 0')).toBe(9);  // 0 hypergiant
    // SIMBAD entries occasionally carry just "I" without the a/b/ab
    // suffix; assigning it to Iab keeps the renderer's size mapping
    // centred on the supergiant class.
    expect(lum('A0I')).toBe(7);
  });

  it('handles composite spectra by parsing the first component', () => {
    expect(classifyFromSimbad('K0III+K7V')).toEqual(mk(5, 0, 4));
  });

  it('parses subdwarfs (sdB, sdO) with lumClass=1', () => {
    expect(classifyFromSimbad('sdB5')).toEqual(mk(1, 5, 1));
    expect(classifyFromSimbad('sdO')).toEqual(mk(0, null, 1));
  });

  it('parses white dwarfs (DA, DB, DA2, DAH)', () => {
    expect(classifyFromSimbad('DA')).toEqual({ kind: 'white-dwarf', wdSubclass: null });
    expect(classifyFromSimbad('DB')!.kind).toBe('white-dwarf');
    expect(classifyFromSimbad('DA2')).toEqual({ kind: 'white-dwarf', wdSubclass: 2 });
    expect(classifyFromSimbad('DAH')!.kind).toBe('white-dwarf');
  });

  it('clamps the white-dwarf subclass digit into [0, 9]', () => {
    expect(classifyFromSimbad('DA0')).toEqual({ kind: 'white-dwarf', wdSubclass: 0 });
    expect(classifyFromSimbad('DA9')).toEqual({ kind: 'white-dwarf', wdSubclass: 9 });
  });

  it('parses fractional subclass digits by taking the integer part', () => {
    expect(classifyFromSimbad('M1.5Iab-b')).toEqual(mk(6, 1, 7));
  });

  it('classifies C / S / N / R stars as carbon', () => {
    // SIMBAD canonical: C5,2e (carbon subclass + abundance index + emission).
    expect(classifyFromSimbad('C5,2e')).toEqual({ kind: 'carbon', subclass: 5 });
    expect(classifyFromSimbad('S4,2')).toEqual({ kind: 'carbon', subclass: 4 });
    expect(classifyFromSimbad('N3')).toEqual({ kind: 'carbon', subclass: 3 });
    expect(classifyFromSimbad('R8')).toEqual({ kind: 'carbon', subclass: 8 });
  });

  it('classifies Wolf-Rayet types with the ionization subclass', () => {
    expect(classifyFromSimbad('WN5')).toEqual({ kind: 'wolf-rayet', subclass: 5 });
    expect(classifyFromSimbad('WN2-w')).toEqual({ kind: 'wolf-rayet', subclass: 2 });
    expect(classifyFromSimbad('WC4')).toEqual({ kind: 'wolf-rayet', subclass: 4 });
  });

  it('classifies WR+MK composites by the V-dominant MK companion', () => {
    // γ² Vel: the O7.5 giant carries the V light the record's absmag
    // measures; the WR-first listing is catalog convention, not
    // brightness order.
    expect(classifyFromSimbad('WC8+O7.5III-V')).toEqual(mk(0, 7, 4));
    expect(classifyFromSimbad('WC4+Be')).toEqual(mk(1, null, null));
    // A non-MK companion leaves the WR single.
    expect(classifyFromSimbad('WN6/WC4')).toEqual({ kind: 'wolf-rayet', subclass: 6 });
  });

  it('handles Am/Ap composite tags by preferring the m-line (metallic) type', () => {
    // kA5hA8mF1(III)SiEuBa → metals dominate → F1 III.
    expect(classifyFromSimbad('kA5hA8mF1(III)SiEuBa')).toEqual(mk(3, 1, 4));
  });

  it('handles composite tags without an explicit luminosity class', () => {
    expect(classifyFromSimbad('kA7hA7mF3')).toEqual(mk(3, 3, null));
  });

  it('returns null when the leading character is not a recognised class', () => {
    // SIMBAD writes some non-stellar entries; the resolver falls
    // through to GSP-Spec / unknown rather than guessing.
    expect(classifyFromSimbad('PEC')).toBeNull();
    expect(classifyFromSimbad('?')).toBeNull();
    expect(classifyFromSimbad('X5')).toBeNull();
  });
});

// 14 AT-HYG rows whose `spect` cell carries non-MK content (variability
// annotations like "DELTA DEL" / "CVIIe", Yerkes-notation prefixes like
// "dK0", or non-WD "D"-prefixed labels). Each entry pairs the
// SIMBAD-canonical sp_type with the exact variant the classifier must
// return, so any drift toward a white dwarf fails fast.

describe('classifyFromSimbad — non-MK AT-HYG bug rows', () => {
  const rows = [
    { label: 'HIP 102843', spType: 'A6V',                  want: mk(2, 6, 2) },
    { label: 'HIP 60978',  spType: 'A8V',                  want: mk(2, 8, 2) },
    { label: 'HIP 32151',  spType: 'kA6hA7mF1(III)',       want: mk(3, 1, 4) },
    { label: 'HIP 27192',  spType: 'A3V',                  want: mk(2, 3, 2) },
    { label: 'HIP 5588',   spType: 'kA5hA8mF1(III)SiEuBa', want: mk(3, 1, 4) },
    { label: 'HIP 40342',  spType: 'F1IV',                 want: mk(3, 1, 3) },
    { label: 'HIP 22303',  spType: 'kA7hA7mF3',            want: mk(3, 3, null) },
    { label: 'HIP 45150',  spType: 'F1Vn',                 want: mk(3, 1, 2) },
    { label: 'HIP 42297',  spType: 'kA8hF2mF5(III)Eu',     want: mk(3, 5, 4) },
    { label: 'HIP 10267',  spType: 'G0',                   want: mk(4, 0, null) },
    { label: 'HD 190780',  spType: 'K0',                   want: mk(5, 0, null) },
    { label: 'HIP 45266',  spType: 'C5,2e',                want: { kind: 'carbon', subclass: 5 } },
    { label: 'HIP 30449',  spType: 'C6,2e',                want: { kind: 'carbon', subclass: 6 } },
    { label: 'HIP 51280',  spType: 'K7V',                  want: mk(5, 7, 2) },
  ];

  it.each(rows)('$label / "$spType"', ({ spType, want }) => {
    expect(classifyFromSimbad(spType)).toEqual(want);
  });

  it('covers all 14 known non-MK bug rows', () => {
    expect(rows).toHaveLength(14);
  });
});

// SIMBAD retains Yerkes lowercase prefixes ("d" = dwarf, "g" = giant)
// on nearby M dwarfs and late-type giants. The prefix IS the luminosity
// declaration, so it overrides any trailing Roman. Without explicit
// handling these rows fail the first-char gate and leak to the GSP-Spec
// tier; counting confirms 169 dM* rows in the live TSV at fix time.

describe('classifyFromSimbad — Yerkes prefix', () => {
  const rows = [
    { spType: 'dM4.0',   want: mk(6, 4, 2) },
    { spType: 'dM3.5',   want: mk(6, 3, 2) },
    { spType: 'dM5',     want: mk(6, 5, 2) },
    { spType: 'dM4.5e',  want: mk(6, 4, 2) },
    { spType: 'dK0',     want: mk(5, 0, 2) },
    { spType: 'gK0',     want: mk(5, 0, 4) },
    { spType: 'dM3+dM3', want: mk(6, 3, 2) },
  ];

  it.each(rows)('"$spType"', ({ spType, want }) => {
    expect(classifyFromSimbad(spType)).toEqual(want);
  });

  it('does not strip "d" when followed by a non-MK letter (lets the WD branch see it)', () => {
    expect(classifyFromSimbad('dX0')).toBeNull();
  });
});

describe('resolveSpectDisplay', () => {
  it('passes through the resolver-supplied string when present', () => {
    expect(resolveSpectDisplay('A6V', 'DELTA DEL')).toBe('A6V');
  });

  it('falls back to the cleaned raw cell when the resolver returned null', () => {
    expect(resolveSpectDisplay(null, '  G2  V**  ')).toBe('G2 V');
  });

  it('returns null when both resolver and raw cell are blank', () => {
    expect(resolveSpectDisplay(null, '')).toBeNull();
    expect(resolveSpectDisplay(null, '   ')).toBeNull();
  });

  it('strips trailing AT-HYG continuation markers (*+) but not leading ones', () => {
    expect(resolveSpectDisplay(null, 'M3V***')).toBe('M3V');
    expect(resolveSpectDisplay(null, '+K0III')).toBe('+K0III');
  });
});

describe('classifyFromGspspec', () => {
  it('returns null for null, empty, and "unknown" enum values', () => {
    expect(classifyFromGspspec(null)).toBeNull();
    expect(classifyFromGspspec(undefined)).toBeNull();
    expect(classifyFromGspspec('')).toBeNull();
    expect(classifyFromGspspec('unknown')).toBeNull();
    expect(classifyFromGspspec('UNKNOWN')).toBeNull();
  });

  it('maps each MK letter to a class stating no subclass or luminosity class', () => {
    for (const [s, letter] of [['O', 0], ['B', 1], ['A', 2], ['F', 3], ['G', 4], ['K', 5], ['M', 6]] as const) {
      expect(classifyFromGspspec(s)).toEqual(mk(letter, null, null));
    }
  });

  it('maps CSTAR to carbon with no subclass', () => {
    expect(classifyFromGspspec('CSTAR')).toEqual({ kind: 'carbon', subclass: null });
  });

  it('reads the same as a bare SIMBAD letter', () => {
    expect(classifyFromGspspec('K')).toEqual(classifyFromSimbad('K'));
  });

  it('returns null for any unrecognised letter (no defaulting)', () => {
    expect(classifyFromGspspec('X')).toBeNull();
    expect(classifyFromGspspec('Z')).toBeNull();
  });
});

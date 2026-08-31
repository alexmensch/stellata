import { describe, it, expect } from 'vitest';
import {
  classifyFromGspspec,
  classifyFromSimbad,
  resolveSpectDisplay,
  spectClassIndex,
} from './spectral-classify';

describe('spectClassIndex', () => {
  it('maps the seven main MK classes to indices 0..6', () => {
    expect(spectClassIndex('O')).toBe(0);
    expect(spectClassIndex('B')).toBe(1);
    expect(spectClassIndex('A')).toBe(2);
    expect(spectClassIndex('F')).toBe(3);
    expect(spectClassIndex('G')).toBe(4);
    expect(spectClassIndex('K')).toBe(5);
    expect(spectClassIndex('M')).toBe(6);
  });

  it('groups carbon and Wolf-Rayet variants under index 7', () => {
    // C (carbon), S (zirconium oxide), W (Wolf-Rayet), N (legacy carbon),
    // R (legacy carbon) — all visually-distinct rare classes that share a
    // single renderer bucket.
    expect(spectClassIndex('C')).toBe(7);
    expect(spectClassIndex('S')).toBe(7);
    expect(spectClassIndex('W')).toBe(7);
    expect(spectClassIndex('N')).toBe(7);
    expect(spectClassIndex('R')).toBe(7);
  });

  it('returns 8 (unknown) for any unrecognised letter', () => {
    expect(spectClassIndex('X')).toBe(8);
    expect(spectClassIndex('')).toBe(8);
    expect(spectClassIndex('?')).toBe(8);
  });
});

describe('classifyFromSimbad', () => {
  it('returns null for empty / nullish input (caller falls through tier)', () => {
    expect(classifyFromSimbad('')).toBeNull();
    expect(classifyFromSimbad(null)).toBeNull();
    expect(classifyFromSimbad(undefined)).toBeNull();
  });

  it('parses a basic main-sequence type', () => {
    const info = classifyFromSimbad('G2V');
    expect(info).not.toBeNull();
    expect(info!.classIdx).toBe(4); // G
    expect(info!.subclass).toBe(2);
    expect(info!.lumClass).toBe(2); // V
    expect(info!.isWhiteDwarf).toBe(false);
  });

  it('parses giant and supergiant luminosity classes', () => {
    expect(classifyFromSimbad('K0III')!.lumClass).toBe(4); // III
    expect(classifyFromSimbad('M2II')!.lumClass).toBe(5);  // II
    expect(classifyFromSimbad('B5IV')!.lumClass).toBe(3);  // IV
    expect(classifyFromSimbad('M1Ia')!.lumClass).toBe(8);  // Ia
    expect(classifyFromSimbad('M1Iab')!.lumClass).toBe(7); // Iab
    expect(classifyFromSimbad('B0Ib')!.lumClass).toBe(6);  // Ib
    expect(classifyFromSimbad('A0VII')!.lumClass).toBe(0); // VII (rare)
    expect(classifyFromSimbad('K3VI')!.lumClass).toBe(1);  // VI (subdwarf)
  });

  it('parses Ia+ / 0 hypergiants', () => {
    expect(classifyFromSimbad('B5Ia+')!.lumClass).toBe(9);
    expect(classifyFromSimbad('M2 0')!.lumClass).toBe(9);
  });

  it('treats bare "I" as Iab (intermediate supergiant)', () => {
    // SIMBAD entries occasionally carry just "I" without the a/b/ab
    // suffix; assigning it to Iab keeps the renderer's size mapping
    // centred on the supergiant class rather than over- or under-
    // promoting.
    expect(classifyFromSimbad('A0I')!.lumClass).toBe(7);
  });

  it('handles composite spectra by parsing the first component', () => {
    // K0III+K7V → primary is K0III. The "+" composite separator is left
    // for the caller to ignore; the parser doesn't try to split.
    const info = classifyFromSimbad('K0III+K7V');
    expect(info!.classIdx).toBe(5); // K
    expect(info!.subclass).toBe(0);
    expect(info!.lumClass).toBe(4); // III
  });

  it('parses subdwarfs (sdB, sdO) with lumClass=1', () => {
    const info = classifyFromSimbad('sdB5');
    expect(info!.classIdx).toBe(1);   // B
    expect(info!.subclass).toBe(5);
    expect(info!.lumClass).toBe(1);   // VI (subdwarf)
    expect(info!.isWhiteDwarf).toBe(false);
  });

  it('parses white dwarfs (DA, DB, DA2, DAH)', () => {
    expect(classifyFromSimbad('DA')!.isWhiteDwarf).toBe(true);
    expect(classifyFromSimbad('DB')!.isWhiteDwarf).toBe(true);
    expect(classifyFromSimbad('DA2')!.wdSubclass).toBe(2);
    expect(classifyFromSimbad('DA2')!.lumClass).toBe(0); // VII
    expect(classifyFromSimbad('DAH')!.isWhiteDwarf).toBe(true);
  });

  it('clamps the white-dwarf subclass digit into [0, 9]', () => {
    expect(classifyFromSimbad('DA0')!.wdSubclass).toBe(0);
    expect(classifyFromSimbad('DA9')!.wdSubclass).toBe(9);
  });

  it('parses fractional subclass digits by taking the integer part', () => {
    // M1.5Iab-b → subclass=1 (integer part of 1.5)
    expect(classifyFromSimbad('M1.5Iab-b')!.subclass).toBe(1);
    expect(classifyFromSimbad('M1.5Iab-b')!.lumClass).toBe(7);
  });

  it('classifies carbon / S / Wolf-Rayet stars under classIdx=7', () => {
    // SIMBAD canonical: C5,2e (carbon subclass + abundance index + emission).
    // WC4 / WN5 (Wolf-Rayet sub-types). No luminosity-class slot for any.
    const carbon = classifyFromSimbad('C5,2e');
    expect(carbon!.classIdx).toBe(7);
    expect(carbon!.subclass).toBe(5);
    expect(carbon!.lumClass).toBe(255);
    expect(carbon!.isWhiteDwarf).toBe(false);
    expect(classifyFromSimbad('WC4')!.classIdx).toBe(7);
    expect(classifyFromSimbad('WN5')!.classIdx).toBe(7);
  });

  it('flags Wolf-Rayet types with the ionization subclass', () => {
    const wn5 = classifyFromSimbad('WN5')!;
    expect(wn5.isWolfRayet).toBe(true);
    expect(wn5.subclass).toBe(5);
    expect(classifyFromSimbad('WN2-w')!.subclass).toBe(2);
    expect(classifyFromSimbad('WC4')!.subclass).toBe(4);
    // Carbon / S stars share classIdx 7 but are NOT Wolf-Rayets.
    expect(classifyFromSimbad('C5,2e')!.isWolfRayet).toBeUndefined();
  });

  it('classifies WR+MK composites by the V-dominant MK companion', () => {
    // γ² Vel: the O7.5 giant carries the V light the record's absmag
    // measures; the WR-first listing is catalog convention, not
    // brightness order.
    const gv = classifyFromSimbad('WC8+O7.5III-V')!;
    expect(gv.classIdx).toBe(0);       // O
    expect(gv.subclass).toBe(7);
    expect(gv.lumClass).toBe(4);       // III
    expect(gv.isWolfRayet).toBeUndefined();
    // Unclassifiable companion → stays a WR single.
    const wc4be = classifyFromSimbad('WC4+Be')!;
    expect(wc4be.classIdx).toBe(1);    // Be parses as B
    const wnwc = classifyFromSimbad('WN6/WC4')!;
    expect(wnwc.classIdx).toBe(7);
    expect(wnwc.isWolfRayet).toBe(true);
  });

  it('handles Am/Ap composite tags by preferring the m-line (metallic) type', () => {
    // kA5hA8mF1(III)SiEuBa → metals dominate → F1 III.
    const info = classifyFromSimbad('kA5hA8mF1(III)SiEuBa');
    expect(info!.classIdx).toBe(3); // F
    expect(info!.subclass).toBe(1);
    expect(info!.lumClass).toBe(4); // III
  });

  it('handles composite tags without an explicit luminosity class', () => {
    // kA7hA7mF3 → m-line F3, no Roman → lumClass unknown.
    const info = classifyFromSimbad('kA7hA7mF3');
    expect(info!.classIdx).toBe(3);
    expect(info!.subclass).toBe(3);
    expect(info!.lumClass).toBe(255);
  });

  it('returns null when the leading character is not a recognised class', () => {
    // SIMBAD writes some non-stellar entries; the resolver falls
    // through to GSP-Spec / the unknown sentinel rather than guessing.
    expect(classifyFromSimbad('PEC')).toBeNull();
    expect(classifyFromSimbad('?')).toBeNull();
  });
});

// 14 AT-HYG rows whose `spect` cell carries non-MK content (variability
// annotations like "DELTA DEL" / "CVIIe", Yerkes-notation prefixes like
// "dK0", or non-WD "D"-prefixed labels). Each entry pairs the
// SIMBAD-canonical sp_type with the real classIdx / subclass / lumClass
// the classifier must return. classIdx + lumClass are `toBe(N)` rather
// than `toBeLessThan` so any drift toward isWhiteDwarf=true fails fast.

describe('classifyFromSimbad — non-MK AT-HYG bug rows', () => {
  interface BugRow {
    label: string;     // HIP or HD id from the bug table
    spType: string;    // canonical SIMBAD sp_type
    classIdx: number;  // expected classIdx after the fix
    subclass: number;  // expected subclass digit
    lumClass: number;  // expected lumClass (255 if SIMBAD didn't supply one)
  }
  const rows: BugRow[] = [
    { label: 'HIP 102843', spType: 'A6V',                  classIdx: 2, subclass: 6, lumClass: 2 },
    { label: 'HIP 60978',  spType: 'A8V',                  classIdx: 2, subclass: 8, lumClass: 2 },
    { label: 'HIP 32151',  spType: 'kA6hA7mF1(III)',       classIdx: 3, subclass: 1, lumClass: 4 },
    { label: 'HIP 27192',  spType: 'A3V',                  classIdx: 2, subclass: 3, lumClass: 2 },
    { label: 'HIP 5588',   spType: 'kA5hA8mF1(III)SiEuBa', classIdx: 3, subclass: 1, lumClass: 4 },
    { label: 'HIP 40342',  spType: 'F1IV',                 classIdx: 3, subclass: 1, lumClass: 3 },
    { label: 'HIP 22303',  spType: 'kA7hA7mF3',            classIdx: 3, subclass: 3, lumClass: 255 },
    { label: 'HIP 45150',  spType: 'F1Vn',                 classIdx: 3, subclass: 1, lumClass: 2 },
    { label: 'HIP 42297',  spType: 'kA8hF2mF5(III)Eu',     classIdx: 3, subclass: 5, lumClass: 4 },
    { label: 'HIP 10267',  spType: 'G0',                   classIdx: 4, subclass: 0, lumClass: 255 },
    { label: 'HD 190780',  spType: 'K0',                   classIdx: 5, subclass: 0, lumClass: 255 },
    { label: 'HIP 45266',  spType: 'C5,2e',                classIdx: 7, subclass: 5, lumClass: 255 },
    { label: 'HIP 30449',  spType: 'C6,2e',                classIdx: 7, subclass: 6, lumClass: 255 },
    { label: 'HIP 51280',  spType: 'K7V',                  classIdx: 5, subclass: 7, lumClass: 2 },
  ];

  it.each(rows)(
    '$label / "$spType" → classIdx=$classIdx lumClass=$lumClass (not WD)',
    ({ spType, classIdx, subclass, lumClass }) => {
      const info = classifyFromSimbad(spType);
      expect(info).not.toBeNull();
      expect(info!.isWhiteDwarf).toBe(false);
      expect(info!.classIdx).toBe(classIdx);
      expect(info!.subclass).toBe(subclass);
      expect(info!.lumClass).toBe(lumClass);
    },
  );

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
  interface YerkesRow {
    spType: string;
    classIdx: number;
    subclass: number;
    lumClass: number;
  }
  const rows: YerkesRow[] = [
    { spType: 'dM4.0',  classIdx: 6, subclass: 4, lumClass: 2 },
    { spType: 'dM3.5',  classIdx: 6, subclass: 3, lumClass: 2 },
    { spType: 'dM5',    classIdx: 6, subclass: 5, lumClass: 2 },
    { spType: 'dM4.5e', classIdx: 6, subclass: 4, lumClass: 2 },
    { spType: 'dK0',    classIdx: 5, subclass: 0, lumClass: 2 },
    { spType: 'gK0',    classIdx: 5, subclass: 0, lumClass: 4 },
    { spType: 'dM3+dM3', classIdx: 6, subclass: 3, lumClass: 2 },
  ];

  it.each(rows)(
    '"$spType" → classIdx=$classIdx subclass=$subclass lumClass=$lumClass (not WD)',
    ({ spType, classIdx, subclass, lumClass }) => {
      const info = classifyFromSimbad(spType);
      expect(info).not.toBeNull();
      expect(info!.isWhiteDwarf).toBe(false);
      expect(info!.classIdx).toBe(classIdx);
      expect(info!.subclass).toBe(subclass);
      expect(info!.lumClass).toBe(lumClass);
    },
  );

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

  it('maps each MK letter to its classIdx with neutral subclass and lumClass', () => {
    for (const [letter, idx] of [['O', 0], ['B', 1], ['A', 2], ['F', 3], ['G', 4], ['K', 5], ['M', 6]] as const) {
      const info = classifyFromGspspec(letter);
      expect(info).not.toBeNull();
      expect(info!.classIdx).toBe(idx);
      expect(info!.subclass).toBe(5);
      expect(info!.lumClass).toBe(255);
      expect(info!.isWhiteDwarf).toBe(false);
    }
  });

  it('maps CSTAR to the carbon bucket (classIdx=7)', () => {
    const info = classifyFromGspspec('CSTAR');
    expect(info!.classIdx).toBe(7);
    expect(info!.lumClass).toBe(255);
  });

  it('returns null for any unrecognised letter (no defaulting)', () => {
    expect(classifyFromGspspec('X')).toBeNull();
    expect(classifyFromGspspec('Z')).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  spectClassIndex,
  classifyFromSimbad,
  classifyFromGspspec,
  resolveSpectralInfo,
  resolveSpectDisplay,
  parseSimbadSptypeTsv,
  SPECTRAL_UNKNOWN,
  SOLAR_BV_FALLBACK,
  spectralClassCi,
  spectralClassColorIsDerivable,
  tempKelvin,
  boloCorr,
  physicalRadius,
  resolveApsisTeff,
  absmagFromSpectral,
  spectralFromAbsmag,
  GAIA_BINDING_G_MINUS_V_REJECT_MAG,
  normalizeGcvsName,
  parseGcvsNumber,
  splitPipeDelimited,
  classifyGcvsVarType,
  isPlanetaryTransitOnly,
  VAR_TYPE_UNKNOWN,
  VAR_TYPE_PULSATING,
  VAR_TYPE_ECLIPSING,
  VAR_TYPE_OTHER,
  VAR_TYPE_MIRA,
  VAR_TYPE_SEMIREGULAR,
  VAR_TYPE_CEPHEID,
  VAR_TYPE_RR_LYRAE,
  VAR_TYPE_DSCT,
  inferBinaries,
  pickBrightest,
  markPrimary,
  markPrimaryIfUnflagged,
  applyDoublesFlag,
  isOpticalDoublePrimary,
  isGaiaQualityDist,
  OPTICAL_DOUBLE_MIN_SEP_PC,
  type OpticalDoubleStar,
  type OpticalDoubleContext,
  type SearchEntry,
  type SearchEntrySource,
  buildSearchEntry,
  NO_CONSTELLATION_INDEX,
  designationConIndex,
  buildHipToIndex,
  BINARY_MAX_SEP_PC,
  FLAG_HAS_NAME,
  FLAG_IS_SOL,
  FLAG_HAS_BAYER,
  FLAG_BINARY_COMPANION_ONLY,
  FLAG_BINARY_COMPANION_SYNTHETIC,
  FLAG_BINARY_PRIMARY,
  FLAGS,
  RESERVED_FLAG_BITS,
  HEADER_LAYOUT,
  RECORD_LAYOUT,
  HEADER_FIELD_SIZES,
  RECORD_FIELD_SIZES,
  RECORD_RESERVED_TAIL_BYTES,
  MULTIPLICITY_SINGLE,
  MULTIPLICITY_RESOLVED,
  MULTIPLICITY_UNRESOLVED,
  HEADER_SIZE,
  RECORD_SIZE,
  MAGIC,
  BINARY_VERSION,
  NO_APSIS,
  NAME_TABLE_PADDING,
  NAME_LENGTH_PREFIX_BYTES,
  AMP_MAG_PER_UNIT,
  PERIOD_DAYS_PER_UNIT,
  RECORD_FIELD_KINDS,
  encodeAmpUnits,
  encodePeriodUnits,
  decodeRecordColumn,
  decodeRecordColumnBig,
  readCatalogHeader,
  readNameTable,
  readRecordField,
  readRecordFieldBig,
  writeCatalogHeader,
  writeStarRecord,
  type NumericRecordField,
  type WireStarRecord,
  planCatalogChunks,
  assembleCatalogChunks,
  type CatalogManifest,
  parseGaiaApsisTsv,
  type ApsisRow,
  type SimbadSpectralRow,
  type SimbadSpectralIndex,
  type SpectralInfo,
  type BinaryStar,
  type DoublesStar,
  parseBailerJonesTsv,
  apparentToAbsoluteMagnitude,
  buildDistanceOverride,
  applyBailerJonesOverride,
  isBailerJonesEligible,
  resolveGaiaSourceId,
  parseGaiaSourceIdStr,
  parseSimbadWdsXidsTsv,
  isSiblingLetterAttribution,
  BJ_ELIGIBLE_DIST_SRCS,
  DIST_SRC_BUCKETS,
  distSrcBucket,
  emptyDistSrcPartition,
  tallyDistSrc,
  applyLmcKinematicOverride,
  isInLmcCone,
  angularSeparationDeg,
  LMC_DISTANCE_PC,
  LMC_CENTRE_RA_HOURS,
  LMC_CENTRE_DEC_DEG,
  LMC_CONE_HALF_ANGLE_DEG,
  LMC_PM_RA_CENTRE,
  LMC_PM_DEC_CENTRE,
  LMC_PM_TOLERANCE,
} from './catalog-pure';
import { MAX_DIST_PC } from './parse/stars-parse';

describe('catalog-pure / spectClassIndex', () => {
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

describe('catalog-pure / spectralClassCi', () => {
  it('derives a hot-blue B−V for an early-type class (tier 4)', () => {
    const ci = spectralClassCi(classifyFromSimbad('B2V')!);
    expect(ci).toBeLessThan(0); // blue
    expect(ci).not.toBe(SOLAR_BV_FALLBACK);
  });

  it('derives a cool-red B−V for a late-type class (tier 4)', () => {
    const ci = spectralClassCi(classifyFromSimbad('M2V')!);
    expect(ci).toBeGreaterThan(1); // red
  });

  it('routes a white dwarf through its Sion Teff (tier 5)', () => {
    const ci = spectralClassCi(classifyFromSimbad('DA2')!);
    // 50400/2 = 25200 K → deep blue, distinct from the solar fallback.
    expect(ci).toBeLessThan(0);
    expect(ci).not.toBe(SOLAR_BV_FALLBACK);
  });

  it('falls back to solar for an unparseable / unknown class (tier 6)', () => {
    expect(spectralClassCi(SPECTRAL_UNKNOWN)).toBe(SOLAR_BV_FALLBACK);
  });

  it('spectralClassColorIsDerivable gates the tier-4/5 bake from the fallback', () => {
    // The ciSpectralDerived counter reads this, not `ci !== 0.65` — a
    // parseable class landing exactly on the fallback value must still
    // count as derived.
    expect(spectralClassColorIsDerivable(classifyFromSimbad('G2V')!)).toBe(true);
    expect(spectralClassColorIsDerivable(classifyFromSimbad('DA2')!)).toBe(true);
    expect(spectralClassColorIsDerivable(SPECTRAL_UNKNOWN)).toBe(false);
  });
});

describe('catalog-pure / classifyFromSimbad', () => {
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
describe('catalog-pure / classifyFromSimbad — non-MK AT-HYG bug rows', () => {
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
describe('catalog-pure / classifyFromSimbad — Yerkes prefix', () => {
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

describe('catalog-pure / resolveSpectDisplay', () => {
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

describe('catalog-pure / classifyFromGspspec', () => {
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

describe('catalog-pure / resolveSpectralInfo — tier priority', () => {
  const GAIA_ID = '1234567890';
  const HIP = 14576;
  const APSIS_NONE: ApsisRow = {
    teffGspphot: null, loggGspphot: null, mhGspphot: null, azeroGspphot: null,
    teffGspspec: null, loggGspspec: null, mhGspspec: null, spectraltypeEsphs: null,
  };
  const idx = (
    bySource: [string, SimbadSpectralRow][] = [],
    byHip: [number, SimbadSpectralRow][] = [],
  ): SimbadSpectralIndex => ({ bySource: new Map(bySource), byHip: new Map(byHip) });

  it('tier 0: curated HIP override outranks every machine tier (Castor)', () => {
    // HIP 36850 (Castor A) — SIMBAD '* alf Gem A' carries neither hip
    // nor source_id, so without the curated tier the record is
    // spectral-unknown and the radius chain inflates ~3×.
    const simbad = idx([], [[36850, { spType: 'K0III', spQual: 'C', otype: '**' }]]);
    const out = resolveSpectralInfo(null, 36850, simbad, new Map());
    expect(out.source).toBe('curated');
    expect(out.info.classIdx).toBe(2); // A
    expect(out.info.lumClass).toBe(3); // IV
    expect(out.spectDisplay).toBe('A1.5IV');
  });

  it('tier 1: SIMBAD-by-source_id wins when present and parseable', () => {
    const simbad = idx([[GAIA_ID, { spType: 'A6V', spQual: 'C', otype: 'PM*' }]]);
    const apsis = new Map<string, ApsisRow>([
      [GAIA_ID, { ...APSIS_NONE, spectraltypeEsphs: 'G' }],
    ]);
    const out = resolveSpectralInfo(GAIA_ID, HIP, simbad, apsis);
    expect(out.source).toBe('simbad');
    expect(out.info.classIdx).toBe(2); // A
    expect(out.info.subclass).toBe(6);
    expect(out.info.lumClass).toBe(2); // V
    expect(out.spectDisplay).toBe('A6V');
  });

  it('tier 2: SIMBAD-by-HIP rescues a Gaia-saturated star (no source_id)', () => {
    const simbad = idx([], [[HIP, { spType: 'B8V', spQual: 'C', otype: 'SB*' }]]);
    const out = resolveSpectralInfo(null, HIP, simbad, new Map());
    expect(out.source).toBe('simbad');
    expect(out.info.classIdx).toBe(1); // B
    expect(out.info.subclass).toBe(8);
    expect(out.info.lumClass).toBe(2); // V
    expect(out.spectDisplay).toBe('B8V');
  });

  it('tier 2: SIMBAD-by-HIP beats GSP-Spec (full MK over letter-only enum)', () => {
    const simbad = idx([], [[HIP, { spType: 'A2IV', spQual: 'C', otype: '**' }]]);
    const apsis = new Map<string, ApsisRow>([
      [GAIA_ID, { ...APSIS_NONE, spectraltypeEsphs: 'K' }],
    ]);
    const out = resolveSpectralInfo(GAIA_ID, HIP, simbad, apsis);
    expect(out.source).toBe('simbad');
    expect(out.info.classIdx).toBe(2); // A, not K
    expect(out.info.lumClass).toBe(3); // IV
  });

  it('tier 3: GSP-Spec when SIMBAD is absent or unparseable', () => {
    const apsis = new Map<string, ApsisRow>([
      [GAIA_ID, { ...APSIS_NONE, spectraltypeEsphs: 'K' }],
    ]);
    const out = resolveSpectralInfo(GAIA_ID, HIP, idx(), apsis);
    expect(out.source).toBe('gspspec');
    expect(out.info.classIdx).toBe(5); // K
    expect(out.spectDisplay).toBe('K');
  });

  it('tier 3 fires when SIMBAD sp_type is present but unparseable', () => {
    const simbad = idx([[GAIA_ID, { spType: 'PEC', spQual: 'E', otype: 'V*' }]]);
    const apsis = new Map<string, ApsisRow>([
      [GAIA_ID, { ...APSIS_NONE, spectraltypeEsphs: 'F' }],
    ]);
    const out = resolveSpectralInfo(GAIA_ID, HIP, simbad, apsis);
    expect(out.source).toBe('gspspec');
    expect(out.info.classIdx).toBe(3); // F
  });

  it('tier 4: SPECTRAL_UNKNOWN fallback when every upstream tier misses', () => {
    const out = resolveSpectralInfo(GAIA_ID, HIP, idx(), new Map());
    expect(out.source).toBe('fallback');
    expect(out.info).toBe(SPECTRAL_UNKNOWN);
    expect(out.spectDisplay).toBeNull();
  });

  it('tier 4: no source_id and no HIP falls straight through to fallback', () => {
    const simbad = idx([['9999', { spType: 'A0V', spQual: 'C', otype: 'PM*' }]]);
    const out = resolveSpectralInfo(null, null, simbad, new Map());
    expect(out.source).toBe('fallback');
    expect(out.info).toBe(SPECTRAL_UNKNOWN);
  });
});

describe('catalog-pure / parseSimbadSptypeTsv', () => {
  const HDR =
    'simbad_oid\tsimbad_main_id\tsp_type\tsp_qual\tsp_bibcode\totype\thip\tsource_id\n';

  it('parses canonical rows into bySource and byHip', () => {
    const tsv = HDR +
      '57848\t*  56 Cyg\tA6V\tC\t1995ApJS...99..135A\tPM*\t102843\t2067050940754838656\n' +
      '370513\tHD  47606\tkA6hA7mF1(III)\tD\t2020AJ....160...52M\t*\t32151\t1001011023904917760\n';
    const { bySource, byHip } = parseSimbadSptypeTsv(tsv);
    expect(bySource.size).toBe(2);
    expect(byHip.size).toBe(2);
    const a = bySource.get('2067050940754838656');
    expect(a?.spType).toBe('A6V');
    expect(a?.spQual).toBe('C');
    expect(a?.otype).toBe('PM*');
    expect(byHip.get(102843)).toBe(a);
    const b = bySource.get('1001011023904917760');
    expect(b?.spType).toBe('kA6hA7mF1(III)');
  });

  it('indexes a blank-source_id row by HIP (Gaia-saturated bright stars)', () => {
    const tsv = HDR +
      '51431\t* bet Per\tB8V\tC\t\tSB*\t14576\t\n' +
      '999\tBlank\t\t\t\t\t\t1234\n';
    const { bySource, byHip } = parseSimbadSptypeTsv(tsv);
    expect(bySource.size).toBe(1);
    expect(bySource.has('1234')).toBe(true);
    expect(byHip.size).toBe(1);
    expect(byHip.get(14576)?.spType).toBe('B8V');
  });

  it('drops rows with neither source_id nor HIP', () => {
    const tsv = HDR + '42\tNo keys\tG2V\t\t\t\t\t\n';
    const { bySource, byHip } = parseSimbadSptypeTsv(tsv);
    expect(bySource.size).toBe(0);
    expect(byHip.size).toBe(0);
  });

  it('byHip is first-write-wins on duplicate HIP', () => {
    const tsv = HDR +
      '1\tFirst\tB8V\tC\t\t*\t14576\t\n' +
      '2\tSecond\tK0III\tD\t\t*\t14576\t\n';
    const { byHip } = parseSimbadSptypeTsv(tsv);
    expect(byHip.get(14576)?.spType).toBe('B8V');
  });

  it('decodes blank sp_type / sp_qual / otype cells as null', () => {
    const tsv = HDR + '111\t*\t\t\t\t\t\t9876\n';
    const { bySource } = parseSimbadSptypeTsv(tsv);
    const r = bySource.get('9876');
    expect(r?.spType).toBeNull();
    expect(r?.spQual).toBeNull();
    expect(r?.otype).toBeNull();
  });

  it('throws on missing required columns', () => {
    expect(() => parseSimbadSptypeTsv('simbad_oid\tsource_id\n1\t9876\n'))
      .toThrow(/sp_type/);
  });
});

describe('catalog-pure / tempKelvin', () => {
  function info(classIdx: number, subclass: number, lumClass = 2): SpectralInfo {
    return { classIdx, subclass, lumClass, isWhiteDwarf: false, wdSubclass: 0 };
  }

  it('returns Sun-like temperature for G2 (~5778 K target)', () => {
    // Sun is G2V — interpolated table value should be in the right neighbourhood.
    const T = tempKelvin(info(4, 2));
    expect(T).toBeGreaterThan(5500);
    expect(T).toBeLessThan(6000);
  });

  it('is hotter for O than for B than for A...', () => {
    // Spectral class O is the hottest, M the coolest. Monotone non-increasing
    // along the canonical OBAFGKM order (subclass=5 across the board).
    const Ts = [0, 1, 2, 3, 4, 5, 6].map(c => tempKelvin(info(c, 5)));
    for (let i = 1; i < Ts.length; i++) {
      expect(Ts[i]).toBeLessThan(Ts[i - 1]);
    }
  });

  it('white dwarf temperature scales as 50400 / wdSubclass', () => {
    const wd: SpectralInfo = { classIdx: 8, subclass: 5, lumClass: 0, isWhiteDwarf: true, wdSubclass: 2 };
    expect(tempKelvin(wd)).toBeCloseTo(25200, 1);

    const wd5: SpectralInfo = { ...wd, wdSubclass: 5 };
    expect(tempKelvin(wd5)).toBeCloseTo(10080, 1);
  });

  it('uses the unknown-class neutral table when classIdx is out of range', () => {
    // classIdx=999 → falls back to T_TABLE[8] (5000 K flat).
    expect(tempKelvin(info(999, 5))).toBe(5000);
  });

  it('routes Wolf-Rayets through the WR table, not the carbon-star row', () => {
    expect(tempKelvin(classifyFromSimbad('WN5')!)).toBe(75000);
    expect(tempKelvin(classifyFromSimbad('WN2-w')!)).toBe(114000);
    // Carbon stars keep the cool row.
    expect(tempKelvin(classifyFromSimbad('C5,2e')!)).toBe(3000);
  });
});

describe('catalog-pure / physicalRadius', () => {
  function info(classIdx: number, subclass: number, lumClass = 2): SpectralInfo {
    return { classIdx, subclass, lumClass, isWhiteDwarf: false, wdSubclass: 0 };
  }

  it('returns ~1 R☉ for the Sun (G2V, absmag=4.83)', () => {
    // Sun is the calibration point of the whole magnitude system. Within
    // ~10% of 1.0 R☉ is the contract — the table-based BC introduces some
    // play but the answer must round-trip near unity.
    const R = physicalRadius(4.83, info(4, 2));
    expect(R).toBeGreaterThan(0.9);
    expect(R).toBeLessThan(1.2);
  });

  it('returns a tiny radius for white dwarfs (~0.013 R☉, hardcoded)', () => {
    const wd: SpectralInfo = { classIdx: 8, subclass: 5, lumClass: 0, isWhiteDwarf: true, wdSubclass: 2 };
    // WDs ignore absmag and return a fixed small radius — the catalog's
    // absmag for WDs doesn't translate reliably into physical radius via
    // Stefan-Boltzmann.
    expect(physicalRadius(11, wd)).toBeCloseTo(0.013, 5);
    expect(physicalRadius(0, wd)).toBeCloseTo(0.013, 5);
  });

  it('produces a much larger radius for a supergiant than for the Sun', () => {
    // Betelgeuse-ish: M2 supergiant, absmag ≈ -5.85. Stefan-Boltzmann gives
    // the very large radius the chart-mode disc relies on.
    const big = physicalRadius(-5.85, info(6, 2, 7));
    const sun = physicalRadius(4.83, info(4, 2));
    expect(big).toBeGreaterThan(sun * 100);
  });

  it('clamps absurdly bright catalog rows to the upper bound', () => {
    // absmag=-30 is unphysical (pre-cap luminosity ≈ 10^14 L☉). The clamp
    // should saturate at 2500 R☉ rather than letting the ratio explode.
    const R = physicalRadius(-30, info(0, 0));
    expect(R).toBeLessThanOrEqual(2500);
  });

  it('clamps absurdly dim catalog rows to the lower bound', () => {
    // absmag=+30 makes L tiny; without the floor, R would underflow toward 0.
    // Lower clamp keeps red-dwarf-ish minimum so renderable.
    const R = physicalRadius(30, info(6, 9));
    expect(R).toBeGreaterThanOrEqual(0.08);
  });

  it('sizes γ² Vel at combined-light order, not the 2077 R☉ carbon artefact', () => {
    // WC8+O7.5III-V at the corpus absmag −6.001 → the O giant's ~19 R☉
    // (published: WC8 ~6 R☉ + O7.5 ~17 R☉).
    const R = physicalRadius(-6.001, classifyFromSimbad('WC8+O7.5III-V')!);
    expect(R).toBeCloseTo(19.15, 2);
  });

  it('sizes a single WN5 as a compact hot star', () => {
    const R = physicalRadius(-4.0, classifyFromSimbad('WN5')!);
    expect(R).toBeCloseTo(2.1, 1);
  });

  it('sizes off a measured Apsis Teff when supplied (GSP-Spec-tier shape)', () => {
    // A real K0 star classified letter-only lands on subclass 5
    // (T_TABLE 4410 K); its measured Teff 5150 K must win. R ∝ T⁻² so
    // the ratio is exact for a fixed absmag + BC.
    const gspspecK = info(5, 5, 255);
    const tableR = physicalRadius(5.9, gspspecK);
    const apsisR = physicalRadius(5.9, gspspecK, 5150);
    expect(apsisR).toBeCloseTo(tableR * (4410 / 5150) ** 2, 6);
  });

  it('ignores the Teff override for white dwarfs and Wolf-Rayets', () => {
    const wd: SpectralInfo = { classIdx: 8, subclass: 5, lumClass: 0, isWhiteDwarf: true, wdSubclass: 2 };
    expect(physicalRadius(11, wd, 5000)).toBeCloseTo(0.013, 5);
    const wr = classifyFromSimbad('WN5')!;
    expect(physicalRadius(-4.0, wr, 5000)).toBeCloseTo(physicalRadius(-4.0, wr), 9);
  });
});

describe('catalog-pure / resolveApsisTeff', () => {
  const APSIS_NONE: ApsisRow = {
    teffGspphot: null, loggGspphot: null, mhGspphot: null, azeroGspphot: null,
    teffGspspec: null, loggGspspec: null, mhGspspec: null, spectraltypeEsphs: null,
  };

  it('prefers gspphot, falls back to gspspec', () => {
    expect(resolveApsisTeff({ ...APSIS_NONE, teffGspphot: 5150, teffGspspec: 4900 })).toBe(5150);
    expect(resolveApsisTeff({ ...APSIS_NONE, teffGspspec: 4900 })).toBe(4900);
  });

  it('rejects out-of-window values per solution, absent rows, and null', () => {
    // gspphot outside the window falls through to a valid gspspec.
    expect(resolveApsisTeff({ ...APSIS_NONE, teffGspphot: 1500, teffGspspec: 3400 })).toBe(3400);
    expect(resolveApsisTeff({ ...APSIS_NONE, teffGspphot: 70000 })).toBeNull();
    expect(resolveApsisTeff(APSIS_NONE)).toBeNull();
    expect(resolveApsisTeff(null)).toBeNull();
    expect(resolveApsisTeff(undefined)).toBeNull();
  });
});

describe('catalog-pure / boloCorr', () => {
  function info(classIdx: number, subclass: number, lumClass = 2): SpectralInfo {
    return { classIdx, subclass, lumClass, isWhiteDwarf: false, wdSubclass: 0 };
  }

  it('is near zero for solar-type stars', () => {
    // BC for G2V should be a few hundredths — the Sun is the reference.
    expect(Math.abs(boloCorr(info(4, 2)))).toBeLessThan(0.5);
  });

  it('is strongly negative for hot O-class stars (UV-rich)', () => {
    expect(boloCorr(info(0, 0))).toBeLessThan(-3);
  });

  it('is strongly negative for cool M-class stars (IR-rich)', () => {
    expect(boloCorr(info(6, 9))).toBeLessThan(-3);
  });
});

describe('catalog-pure / absmagFromSpectral', () => {
  const mv = (spect: string) => absmagFromSpectral(classifyFromSimbad(spect)!);

  it('pins main-sequence anchors (Pecaut & Mamajek 2013)', () => {
    expect(mv('G2V')).toBeCloseTo(4.68, 2);
    expect(mv('K0V')).toBeCloseTo(5.9, 2);
    expect(mv('M1V')).toBeCloseTo(9.5, 2);
    expect(mv('B8V')).toBeCloseTo(0.0, 2);
  });

  it('subgiants sit at the V/III midpoint — Algol Aa2 (K0IV) lands near +2.9 published', () => {
    expect(mv('K0IV')).toBeCloseTo(3.3, 2);
  });

  it('giants read the III table', () => {
    expect(mv('K0III')).toBeCloseTo(0.7, 2);
    expect(mv('G5III')).toBeCloseTo(0.9, 2);
  });

  it('supergiants use per-luminosity-class constants', () => {
    expect(mv('K2II')).toBeCloseTo(-2.3, 2);
    expect(mv('B5Ib')).toBeCloseTo(-4.5, 2);
    expect(mv('M2Iab')).toBeCloseTo(-6.0, 2);
    expect(mv('A0Ia')).toBeCloseTo(-7.5, 2);
  });

  it('unknown luminosity class defaults to main sequence', () => {
    expect(absmagFromSpectral(
      { classIdx: 5, subclass: 0, lumClass: 255, isWhiteDwarf: false, wdSubclass: 0 },
    )).toBeCloseTo(5.9, 2);
  });

  it('returns null where a single calibration would be fiction', () => {
    expect(mv('DA1.9')).toBeNull();                      // white dwarf
    expect(mv('C5,2e')).toBeNull();                      // carbon
    expect(absmagFromSpectral(SPECTRAL_UNKNOWN)).toBeNull();
  });
});

describe('catalog-pure / splitPipeDelimited', () => {
  it('splits lines on | and trims each cell', () => {
    expect(splitPipeDelimited('R     And  |M   | 5.8 ')).toEqual([['R     And', 'M', '5.8']]);
  });

  it('skips blank and whitespace-only lines', () => {
    expect(splitPipeDelimited('a|b\n\n   \nc|d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('accepts CRLF line endings', () => {
    expect(splitPipeDelimited('a|b\r\nc|d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('returns empty for empty input', () => {
    expect(splitPipeDelimited('')).toEqual([]);
  });

  it('keeps empty interior cells', () => {
    expect(splitPipeDelimited('a| |b||')).toEqual([['a', '', 'b', '', '']]);
  });
});

describe('catalog-pure / normalizeGcvsName', () => {
  it('collapses internal whitespace to a single space', () => {
    expect(normalizeGcvsName('R     And')).toBe('R And');
    expect(normalizeGcvsName('V0640    Cas')).toBe('V0640 Cas');
  });

  it('strips trailing asterisks', () => {
    expect(normalizeGcvsName('R And *')).toBe('R And');
    expect(normalizeGcvsName('R And **')).toBe('R And');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeGcvsName('  R And  ')).toBe('R And');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeGcvsName('   ')).toBe('');
  });
});

describe('catalog-pure / parseGcvsNumber', () => {
  it('parses a plain number', () => {
    expect(parseGcvsNumber('5.5')).toBe(5.5);
    expect(parseGcvsNumber('100')).toBe(100);
  });

  it('strips uncertainty markers and brackets', () => {
    expect(parseGcvsNumber('<5.5')).toBe(5.5);
    expect(parseGcvsNumber('5.5:')).toBe(5.5);
    expect(parseGcvsNumber('(5.5)')).toBe(5.5);
    expect(parseGcvsNumber('5.5*')).toBe(5.5);
    expect(parseGcvsNumber('>5.5')).toBe(5.5);
  });

  it('returns null for empty / whitespace input', () => {
    expect(parseGcvsNumber('')).toBeNull();
    expect(parseGcvsNumber('   ')).toBeNull();
  });

  it('returns null for non-numeric input', () => {
    expect(parseGcvsNumber('abc')).toBeNull();
    expect(parseGcvsNumber('---')).toBeNull();
  });

  it('returns null for input that strips down to nothing', () => {
    expect(parseGcvsNumber('()')).toBeNull();
    expect(parseGcvsNumber(':*')).toBeNull();
  });
});

describe('catalog-pure / classifyGcvsVarType', () => {
  it('classifies eclipsing prefixes: EA / EB / EW / ELL / E', () => {
    expect(classifyGcvsVarType('EA')).toBe(VAR_TYPE_ECLIPSING);
    expect(classifyGcvsVarType('EB')).toBe(VAR_TYPE_ECLIPSING);
    expect(classifyGcvsVarType('EW')).toBe(VAR_TYPE_ECLIPSING);
    expect(classifyGcvsVarType('ELL')).toBe(VAR_TYPE_ECLIPSING);
    expect(classifyGcvsVarType('E')).toBe(VAR_TYPE_ECLIPSING);
  });

  it('classifies EP (eclipsing-by-planet) as OTHER, not eclipsing', () => {
    // A transiting-planet host is not a stellar multiple: it must earn
    // no wings and no cosmetic-pulsation suppression as a "binary".
    expect(classifyGcvsVarType('EP')).toBe(VAR_TYPE_OTHER);
  });

  it('flags bare EP hosts as planetary-transit-only; keeps a superimposed pulsator', () => {
    expect(isPlanetaryTransitOnly('EP')).toBe(true);
    expect(isPlanetaryTransitOnly('EP:')).toBe(true);
    // A real intrinsic pulsator superimposed keeps its ring/pulse.
    expect(isPlanetaryTransitOnly('EP+DSCT')).toBe(false);
    // Non-EP types are never dropped by this gate.
    expect(isPlanetaryTransitOnly('EA')).toBe(false);
    expect(isPlanetaryTransitOnly('M')).toBe(false);
  });

  it('classifies composite eclipsing-+-rotational/RS as eclipsing', () => {
    // Algol's "EA/RS" should keep the eclipsing tag — the geometric
    // occlusion is the dominant photometric signal, and superimposing
    // GCVS-amplitude pulsation would double-count the eclipse.
    expect(classifyGcvsVarType('EA/RS')).toBe(VAR_TYPE_ECLIPSING);
    expect(classifyGcvsVarType('EA+RS')).toBe(VAR_TYPE_ECLIPSING);
    expect(classifyGcvsVarType('EB/DM')).toBe(VAR_TYPE_ECLIPSING);
  });

  it('refines intrinsic pulsators into families: M / SR / DCEP / RRAB / RV / DSCT', () => {
    expect(classifyGcvsVarType('M')).toBe(VAR_TYPE_MIRA);
    expect(classifyGcvsVarType('SR')).toBe(VAR_TYPE_SEMIREGULAR);
    expect(classifyGcvsVarType('SRA')).toBe(VAR_TYPE_SEMIREGULAR);
    expect(classifyGcvsVarType('DCEP')).toBe(VAR_TYPE_CEPHEID);
    expect(classifyGcvsVarType('CEP')).toBe(VAR_TYPE_CEPHEID);
    expect(classifyGcvsVarType('RR')).toBe(VAR_TYPE_RR_LYRAE);
    expect(classifyGcvsVarType('RRAB')).toBe(VAR_TYPE_RR_LYRAE);
    // RV Tauri has no dedicated family bucket → generic pulsating fallback.
    expect(classifyGcvsVarType('RV')).toBe(VAR_TYPE_PULSATING);
    expect(classifyGcvsVarType('DSCT')).toBe(VAR_TYPE_DSCT);
  });

  it('maps pulsator subtypes with trailing letters to their family (DCEPS/Polaris, CWA, RVA, LB, DSCTC)', () => {
    // Subtype letters after the family prefix — the tail gate must accept
    // them, not fall through to OTHER.
    expect(classifyGcvsVarType('DCEPS')).toBe(VAR_TYPE_CEPHEID);   // Polaris
    expect(classifyGcvsVarType('DSCTC')).toBe(VAR_TYPE_DSCT);
    expect(classifyGcvsVarType('CWA')).toBe(VAR_TYPE_CEPHEID);     // Type II Cepheid
    expect(classifyGcvsVarType('CWB')).toBe(VAR_TYPE_CEPHEID);
    expect(classifyGcvsVarType('RVA')).toBe(VAR_TYPE_PULSATING);
    expect(classifyGcvsVarType('RVB')).toBe(VAR_TYPE_PULSATING);
    expect(classifyGcvsVarType('LB')).toBe(VAR_TYPE_SEMIREGULAR);  // slow irregular red giant
    expect(classifyGcvsVarType('LC')).toBe(VAR_TYPE_SEMIREGULAR);
    expect(classifyGcvsVarType('ZZA')).toBe(VAR_TYPE_DSCT);        // ZZ Ceti (low-amp)
    expect(classifyGcvsVarType('BCEP')).toBe(VAR_TYPE_DSCT);       // β Cep (low-amp p-mode)
    // Uncertainty-flagged subtype (GCVS ':' after the subtype letter).
    expect(classifyGcvsVarType('SRA:')).toBe(VAR_TYPE_SEMIREGULAR);
    // Composite: rotating + pulsator → the pulsator component wins.
    expect(classifyGcvsVarType('ACV+DSCTC')).toBe(VAR_TYPE_DSCT);
  });

  it('classifies cataclysmic / eruptive / rotating as OTHER', () => {
    expect(classifyGcvsVarType('UGSU')).toBe(VAR_TYPE_OTHER);
    expect(classifyGcvsVarType('ZAND')).toBe(VAR_TYPE_OTHER);
    expect(classifyGcvsVarType('GCAS')).toBe(VAR_TYPE_OTHER);
    expect(classifyGcvsVarType('ACV')).toBe(VAR_TYPE_OTHER);
    expect(classifyGcvsVarType('BY')).toBe(VAR_TYPE_OTHER);
    expect(classifyGcvsVarType('CST')).toBe(VAR_TYPE_OTHER);
    // Non-pulsators that share an initial with a pulsator family must not
    // be promoted by the letter-tail gate (RCB≠RR/RV, RS≠RR, SDOR≠SR).
    expect(classifyGcvsVarType('RCB')).toBe(VAR_TYPE_OTHER);
    expect(classifyGcvsVarType('RS')).toBe(VAR_TYPE_OTHER);
    expect(classifyGcvsVarType('SDOR')).toBe(VAR_TYPE_OTHER);
    expect(classifyGcvsVarType('ACVO')).toBe(VAR_TYPE_OTHER);
  });

  it('returns UNKNOWN for blank, null, or whitespace input', () => {
    expect(classifyGcvsVarType(null)).toBe(VAR_TYPE_UNKNOWN);
    expect(classifyGcvsVarType(undefined)).toBe(VAR_TYPE_UNKNOWN);
    expect(classifyGcvsVarType('')).toBe(VAR_TYPE_UNKNOWN);
    expect(classifyGcvsVarType('   ')).toBe(VAR_TYPE_UNKNOWN);
  });

  it('is case-insensitive', () => {
    expect(classifyGcvsVarType('ea')).toBe(VAR_TYPE_ECLIPSING);
    expect(classifyGcvsVarType('dcep')).toBe(VAR_TYPE_CEPHEID);
  });
});

describe('catalog-pure / inferBinaries', () => {
  function makeStar(opts: Partial<BinaryStar> & { x: number; y: number; z: number; absmag: number }): BinaryStar {
    return { flags: 0, companionIdx: -1, ...opts };
  }

  it('flags a single close pair as a binary', () => {
    // Two stars at 0.001 pc apart — well under BINARY_MAX_SEP_PC (0.005 pc).
    const stars: BinaryStar[] = [
      makeStar({ x: 0, y: 0, z: 0, absmag: 4 }),
      makeStar({ x: 0.001, y: 0, z: 0, absmag: 6 }),
    ];
    const stats = inferBinaries(stars);
    expect(stats.pairs).toBe(2); // both record the other as companion
    expect(stats.mutualPairs).toBe(1);
    expect(stars[0].companionIdx).toBe(1);
    expect(stars[1].companionIdx).toBe(0);
  });

  it('flags the brighter (lower absmag) star as the primary', () => {
    const stars: BinaryStar[] = [
      makeStar({ x: 0, y: 0, z: 0, absmag: 6 }),       // dimmer
      makeStar({ x: 0.001, y: 0, z: 0, absmag: 4 }),   // brighter
    ];
    inferBinaries(stars);
    expect(stars[1].flags & FLAG_BINARY_PRIMARY).toBeTruthy();
    expect(stars[0].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
  });

  it('does not pair stars that are further apart than BINARY_MAX_SEP_PC', () => {
    const stars: BinaryStar[] = [
      makeStar({ x: 0, y: 0, z: 0, absmag: 4 }),
      makeStar({ x: BINARY_MAX_SEP_PC * 2, y: 0, z: 0, absmag: 6 }),
    ];
    const stats = inferBinaries(stars);
    expect(stats.pairs).toBe(0);
    expect(stars[0].companionIdx).toBe(-1);
    expect(stars[1].companionIdx).toBe(-1);
  });

  it('ignores stars exactly at the cutoff (strict less-than)', () => {
    const stars: BinaryStar[] = [
      makeStar({ x: 0, y: 0, z: 0, absmag: 4 }),
      makeStar({ x: BINARY_MAX_SEP_PC, y: 0, z: 0, absmag: 6 }),
    ];
    inferBinaries(stars);
    expect(stars[0].companionIdx).toBe(-1);
  });

  it('picks the nearest neighbour when several are within range', () => {
    const stars: BinaryStar[] = [
      makeStar({ x: 0,      y: 0, z: 0, absmag: 4 }),
      makeStar({ x: 0.0008, y: 0, z: 0, absmag: 6 }),
      makeStar({ x: 0.003,  y: 0, z: 0, absmag: 5 }),
    ];
    inferBinaries(stars);
    expect(stars[0].companionIdx).toBe(1); // nearest, not brightest
  });

  it('does not pair a star with itself', () => {
    const stars: BinaryStar[] = [
      makeStar({ x: 0, y: 0, z: 0, absmag: 4 }),
    ];
    const stats = inferBinaries(stars);
    expect(stats.pairs).toBe(0);
    expect(stars[0].companionIdx).toBe(-1);
  });

  it('handles a triple system by pairing each member with its nearest', () => {
    const stars: BinaryStar[] = [
      makeStar({ x: 0,      y: 0, z: 0, absmag: 4 }),    // A — brightest
      makeStar({ x: 0.001,  y: 0, z: 0, absmag: 5 }),    // B
      makeStar({ x: 0.0009, y: 0, z: 0, absmag: 6 }),    // C
    ];
    const stats = inferBinaries(stars);
    // Distances: A-B=0.001, A-C=0.0009, B-C=0.0001.
    //   A's nearest is C (0.0009). C's nearest is B (0.0001). B's nearest is C.
    // Only B↔C is mutual; A→C is one-way (C points back to B).
    expect(stars[0].companionIdx).toBe(2);
    expect(stars[1].companionIdx).toBe(2);
    expect(stars[2].companionIdx).toBe(1);
    expect(stats.mutualPairs).toBe(1);
    // Primary = brighter of mutual pair B↔C → B (absmag=5 < C's 6).
    expect(stars[1].flags & FLAG_BINARY_PRIMARY).toBeTruthy();
    // A is not part of any mutual pair, so it is NOT flagged primary
    // even though it is the brightest of the three.
    expect(stars[0].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
    expect(stars[2].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
  });

  it('does not flag stars in non-mutual chains as primary', () => {
    // 1D chain A-B-C-D where the inner B-C gap is the tightest, so
    // A→B and D→C (the outer stars point inward) but neither A nor D
    // is the nearest of anyone — they're chain ends. Only B↔C is
    // mutual.
    //   A=0, B=0.0030, C=0.0040, D=0.0070
    //   distances: A-B=0.0030, B-C=0.0010, C-D=0.0030,
    //              A-C=0.0040, A-D=0.0070 (above cutoff), B-D=0.0040.
    //   A→B (closer than C), B→C (0.0010 beats A's 0.0030),
    //   C→B (0.0010 beats D's 0.0030), D→C (closer than B).
    const stars: BinaryStar[] = [
      makeStar({ x: 0,      y: 0, z: 0, absmag: 3 }),
      makeStar({ x: 0.0030, y: 0, z: 0, absmag: 4 }),
      makeStar({ x: 0.0040, y: 0, z: 0, absmag: 5 }),
      makeStar({ x: 0.0070, y: 0, z: 0, absmag: 6 }),
    ];
    const stats = inferBinaries(stars);
    expect(stars[0].companionIdx).toBe(1);
    expect(stars[1].companionIdx).toBe(2);
    expect(stars[2].companionIdx).toBe(1);
    expect(stars[3].companionIdx).toBe(2);
    expect(stats.mutualPairs).toBe(1);
    // Primary = brighter of B↔C → B (absmag=4).
    expect(stars[1].flags & FLAG_BINARY_PRIMARY).toBeTruthy();
    expect(stars[0].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
    expect(stars[2].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
    expect(stars[3].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
  });

  it('flags one primary per mutual pair when there are several', () => {
    // Two well-separated mutual pairs.
    const stars: BinaryStar[] = [
      makeStar({ x: 0,         y: 0, z: 0, absmag: 4 }),  // pair 1
      makeStar({ x: 0.001,     y: 0, z: 0, absmag: 5 }),
      makeStar({ x: 100,       y: 0, z: 0, absmag: 3 }),  // pair 2 (brightest in catalog)
      makeStar({ x: 100.001,   y: 0, z: 0, absmag: 6 }),
    ];
    const stats = inferBinaries(stars);
    expect(stats.mutualPairs).toBe(2);
    expect(stars[0].flags & FLAG_BINARY_PRIMARY).toBeTruthy(); // pair 1 brighter
    expect(stars[1].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
    expect(stars[2].flags & FLAG_BINARY_PRIMARY).toBeTruthy(); // pair 2 brighter
    expect(stars[3].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
  });

  it('returns zero counts for an empty input', () => {
    expect(inferBinaries([])).toEqual({ pairs: 0, mutualPairs: 0 });
  });

  it('uses 3D distance, not 2D', () => {
    // Two stars separated only along z; would be 0 in xy projection.
    const stars: BinaryStar[] = [
      makeStar({ x: 0, y: 0, z: 0,     absmag: 4 }),
      makeStar({ x: 0, y: 0, z: 0.001, absmag: 6 }),
    ];
    inferBinaries(stars);
    expect(stars[0].companionIdx).toBe(1);
  });
});

describe("catalog-pure / markPrimary", () => {
  type Slim = { absmag: number; flags: number };
  const star = (absmag: number, flags = 0): Slim => ({ absmag, flags });

  it("flags the brightest (lowest absmag) of a group", () => {
    const stars: Slim[] = [star(6), star(4), star(5)];
    expect(markPrimary(stars, [0, 1, 2])).toBe(1);
    expect(stars[1].flags & FLAG_BINARY_PRIMARY).toBeTruthy();
    expect(stars[0].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
    expect(stars[2].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
  });

  it("returns -1 for an empty group", () => {
    const stars: Slim[] = [star(4)];
    expect(markPrimary(stars, [])).toBe(-1);
    expect(stars[0].flags).toBe(0);
  });

  it("preserves pre-existing flag bits via OR", () => {
    const stars: Slim[] = [star(4, 0x01)];
    markPrimary(stars, [0]);
    expect(stars[0].flags & 0x01).toBeTruthy();
    expect(stars[0].flags & FLAG_BINARY_PRIMARY).toBeTruthy();
  });

  it("is idempotent under re-application to the same group", () => {
    const stars: Slim[] = [star(4), star(6)];
    markPrimary(stars, [0, 1]);
    const before = stars.map(s => s.flags);
    markPrimary(stars, [0, 1]);
    expect(stars.map(s => s.flags)).toEqual(before);
  });

  it("breaks ties on the first-encountered index", () => {
    // Both equally bright — the helper picks whichever it sees first
    // (matching the prior `i <= j ? i : j` behaviour for mutual pairs).
    const stars: Slim[] = [star(4), star(4)];
    expect(markPrimary(stars, [0, 1])).toBe(0);
  });
});

describe("catalog-pure / markPrimaryIfUnflagged", () => {
  type Slim = { absmag: number; flags: number };
  const star = (absmag: number, flags = 0): Slim => ({ absmag, flags });

  it("delegates to markPrimary when no member is pre-flagged", () => {
    const stars: Slim[] = [star(6), star(4), star(5)];
    expect(markPrimaryIfUnflagged(stars, [0, 1, 2])).toBe(1);
    expect(stars[1].flags & FLAG_BINARY_PRIMARY).toBeTruthy();
  });

  it("returns -2 (skip sentinel) when any member is already flagged", () => {
    // Geometric pass already picked stars[2] (e.g. mutual pair primary).
    // CCDM pass should not re-flag stars[0] even though it is brighter.
    const stars: Slim[] = [star(4), star(6), star(5, FLAG_BINARY_PRIMARY)];
    expect(markPrimaryIfUnflagged(stars, [0, 1, 2])).toBe(-2);
    expect(stars[0].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
    expect(stars[1].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
    expect(stars[2].flags & FLAG_BINARY_PRIMARY).toBeTruthy();
  });

  it("returns -1 for an empty group", () => {
    const stars: Slim[] = [star(4)];
    expect(markPrimaryIfUnflagged(stars, [])).toBe(-1);
  });

  it("is idempotent: a group whose primary it just flagged returns -2 next time", () => {
    const stars: Slim[] = [star(4), star(6)];
    expect(markPrimaryIfUnflagged(stars, [0, 1])).toBe(0);
    expect(markPrimaryIfUnflagged(stars, [0, 1])).toBe(-2);
  });

  it("does not flag any star when bailing on the pre-flagged check", () => {
    const stars: Slim[] = [star(4), star(6, FLAG_BINARY_PRIMARY)];
    markPrimaryIfUnflagged(stars, [0, 1]);
    // stars[0] was brighter but must remain unflagged because stars[1]
    // already carried the bit.
    expect(stars[0].flags).toBe(0);
  });
});

describe('catalog-pure / buildHipToIndex', () => {
  it('maps positive HIPs to their record index and skips null / non-positive', () => {
    const m = buildHipToIndex([
      { hip: 100 },
      { hip: null },
      { hip: 0 },
      { hip: 200 },
    ]);
    expect(m.size).toBe(2);
    expect(m.get(100)).toBe(0);
    expect(m.get(200)).toBe(3);
  });

  it('keeps the FIRST occurrence on duplicate HIPs (brightest under absmag-sorted input)', () => {
    const m = buildHipToIndex([
      { hip: 100 },
      { hip: 100 },
      { hip: 100 },
    ]);
    expect(m.get(100)).toBe(0);
  });
});

describe('catalog-pure / applyDoublesFlag', () => {
  // Mini Star fixture with just the fields applyDoublesFlag reads/writes.
  function s(absmag: number, hip: number | null, flags = 0): DoublesStar {
    return { absmag, hip, flags };
  }

  it('flags the brightest in-catalog member of each group', () => {
    // Three stars; the group covers them all. Lowest absmag (=brightest)
    // should get FLAG_BINARY_PRIMARY; the others stay clean.
    const stars: DoublesStar[] = [s(4, 100), s(2, 200), s(6, 300)];
    const r = applyDoublesFlag(stars, [[100, 200, 300]], buildHipToIndex(stars));
    expect(r.systems).toBe(1);
    expect(r.flagged).toBe(1);
    expect(stars[1].flags).toBe(FLAG_BINARY_PRIMARY);
    expect(stars[0].flags).toBe(0);
    expect(stars[2].flags).toBe(0);
  });

  it('silently drops groups whose HIPs are all missing from the catalog', () => {
    const stars: DoublesStar[] = [s(4, 100), s(5, 200)];
    const r = applyDoublesFlag(stars, [[999, 1000]], buildHipToIndex(stars));
    expect(r.systems).toBe(0);
    expect(r.flagged).toBe(0);
    expect(stars[0].flags).toBe(0);
    expect(stars[1].flags).toBe(0);
  });

  it('counts a system but does not re-flag when a member already has the bit', () => {
    // Geometric pass already flagged the dimmer star; CCDM pass would
    // pick the brighter one but must defer per markPrimaryIfUnflagged's
    // contract.
    const stars: DoublesStar[] = [s(2, 100), s(5, 200, FLAG_BINARY_PRIMARY)];
    const r = applyDoublesFlag(stars, [[100, 200]], buildHipToIndex(stars));
    expect(r.systems).toBe(1);
    expect(r.flagged).toBe(0);
    expect(stars[0].flags).toBe(0);                    // not re-flagged
    expect(stars[1].flags).toBe(FLAG_BINARY_PRIMARY);  // pre-existing bit preserved
  });

  it('flags one primary per group across multiple groups', () => {
    const stars: DoublesStar[] = [
      s(2, 100), s(3, 101), // group A — 100 brightest
      s(5, 200), s(4, 201), // group B — 201 brightest
    ];
    const r = applyDoublesFlag(stars, [[100, 101], [200, 201]], buildHipToIndex(stars));
    expect(r.systems).toBe(2);
    expect(r.flagged).toBe(2);
    expect(stars[0].flags).toBe(FLAG_BINARY_PRIMARY); // 100 won group A
    expect(stars[3].flags).toBe(FLAG_BINARY_PRIMARY); // 201 won group B
    expect(stars[1].flags).toBe(0);
    expect(stars[2].flags).toBe(0);
  });

  it('handles override-style groups (curated visual doubles) the same as CCDM groups', () => {
    // The build-catalog wrapper unions CCDM-from-file groups and the
    // KNOWN_VISUAL_DOUBLES list before calling this; here we verify both
    // sources behave identically once unioned.
    const stars: DoublesStar[] = [s(3, 100), s(2, 101)];
    // Pretend the CCDM pass produced one group, the override another.
    const r = applyDoublesFlag(stars, [[100], [101]], buildHipToIndex(stars));
    expect(r.systems).toBe(2);
    expect(r.flagged).toBe(2);
    // Each single-member group flags its own brightest (and only)
    // component.
    expect(stars[0].flags).toBe(FLAG_BINARY_PRIMARY);
    expect(stars[1].flags).toBe(FLAG_BINARY_PRIMARY);
  });

  it('skips HIP=0 / null records when building the lookup', () => {
    const stars: DoublesStar[] = [s(2, null), s(4, 0), s(3, 100)];
    const r = applyDoublesFlag(stars, [[100]], buildHipToIndex(stars));
    expect(r.systems).toBe(1);
    expect(stars[2].flags).toBe(FLAG_BINARY_PRIMARY);
    // The 0/null-HIP rows must never be hit by HIP→index lookup.
    expect(stars[0].flags).toBe(0);
    expect(stars[1].flags).toBe(0);
  });

  it('is idempotent under re-application', () => {
    const stars: DoublesStar[] = [s(2, 100), s(5, 200)];
    const idx = buildHipToIndex(stars);
    applyDoublesFlag(stars, [[100, 200]], idx);
    const flagsBefore = stars.map((x) => x.flags);
    applyDoublesFlag(stars, [[100, 200]], idx);
    // Second pass sees the existing primary bit and bails — no
    // additional bits set.
    expect(stars.map((x) => x.flags)).toEqual(flagsBefore);
  });

  it('reports suppressed=0 when no suppress predicate is supplied', () => {
    const stars: DoublesStar[] = [s(2, 100), s(5, 200)];
    const r = applyDoublesFlag(stars, [[100, 200]], buildHipToIndex(stars));
    expect(r.suppressed).toBe(0);
  });

  it('vetoes the fresh flag when the suppress predicate fires', () => {
    // Group {100, 200}; 100 is brightest. A predicate that suppresses the
    // picked primary leaves both stars unflagged and counts one suppression.
    const stars: DoublesStar[] = [s(2, 100), s(5, 200)];
    const r = applyDoublesFlag(
      stars,
      [[100, 200]],
      buildHipToIndex(stars),
      (primaryIdx) => primaryIdx === 0,
    );
    expect(r.systems).toBe(1);
    expect(r.flagged).toBe(0);
    expect(r.suppressed).toBe(1);
    expect(stars[0].flags).toBe(0);
    expect(stars[1].flags).toBe(0);
  });

  it('never runs the suppress predicate on an already-flagged group', () => {
    // 200 already winged by a prior pass; the group short-circuits to a
    // no-op before the predicate would see the picked primary.
    const stars: DoublesStar[] = [s(2, 100), s(5, 200, FLAG_BINARY_PRIMARY)];
    let called = false;
    const r = applyDoublesFlag(stars, [[100, 200]], buildHipToIndex(stars), () => {
      called = true;
      return true;
    });
    expect(called).toBe(false);
    expect(r.flagged).toBe(0);
    expect(r.suppressed).toBe(0);
    expect(stars[1].flags).toBe(FLAG_BINARY_PRIMARY);
  });
});

describe('catalog-pure / pickBrightest', () => {
  const s = (absmag: number) => ({ absmag });
  it('returns the lowest-absmag index', () => {
    expect(pickBrightest([s(4), s(2), s(6)], [0, 1, 2])).toBe(1);
  });
  it('returns -1 for an empty index list', () => {
    expect(pickBrightest([s(4)], [])).toBe(-1);
  });
  it('does not mutate — markPrimary is the flag-setting wrapper', () => {
    const stars = [{ absmag: 2, flags: 0 }];
    pickBrightest(stars, [0]);
    expect(stars[0].flags).toBe(0);
  });
});

describe('catalog-pure / markPrimaryIfUnflagged suppress hook', () => {
  const s = (absmag: number, flags = 0) => ({ absmag, flags });
  it('returns -3 and sets no bit when suppress vetoes the pick', () => {
    const stars = [s(2), s(5)];
    expect(markPrimaryIfUnflagged(stars, [0, 1], (i) => i === 0)).toBe(-3);
    expect(stars[0].flags).toBe(0);
    expect(stars[1].flags).toBe(0);
  });
  it('flags normally when suppress returns false', () => {
    const stars = [s(2), s(5)];
    expect(markPrimaryIfUnflagged(stars, [0, 1], () => false)).toBe(0);
    expect(stars[0].flags).toBe(FLAG_BINARY_PRIMARY);
  });
  it('short-circuits (-2) before consulting suppress on an already-flagged member', () => {
    const stars = [s(2), s(5, FLAG_BINARY_PRIMARY)];
    let called = false;
    expect(markPrimaryIfUnflagged(stars, [0, 1], () => { called = true; return true; })).toBe(-2);
    expect(called).toBe(false);
  });
});

describe('catalog-pure / isGaiaQualityDist', () => {
  it('accepts Gaia inverse-parallax dist_src (G_R3, G_R2)', () => {
    expect(isGaiaQualityDist('G_R3')).toBe(true);
    expect(isGaiaQualityDist('G_R2')).toBe(true);
  });
  it('rejects non-Gaia and null dist_src', () => {
    expect(isGaiaQualityDist('HIP')).toBe(false);
    expect(isGaiaQualityDist('GJ')).toBe(false);
    expect(isGaiaQualityDist(null)).toBe(false);
  });
});

describe('catalog-pure / isOpticalDoublePrimary', () => {
  // Two components 3 pc apart on the x-axis, both Gaia-quality, no physical
  // evidence — the canonical optical double.
  function make(overrides: Partial<OpticalDoubleStar>[] = []): OpticalDoubleStar[] {
    const base: OpticalDoubleStar = {
      absmag: 0, x: 0, y: 0, z: 0, hip: null, gaiaSourceId: null,
      athygDistSrc: 'G_R3', varType: VAR_TYPE_UNKNOWN,
    };
    const stars: OpticalDoubleStar[] = [
      { ...base, hip: 100 },
      { ...base, hip: 200, x: 3 },
    ];
    overrides.forEach((o, i) => Object.assign(stars[i], o));
    return stars;
  }
  const ctx = (over: Partial<OpticalDoubleContext> = {}): OpticalDoubleContext => ({
    physicalHips: new Set(), physicalGaia: new Set(),
    minSepPc: OPTICAL_DOUBLE_MIN_SEP_PC, ...over,
  });

  it('suppresses when the nearest Gaia-quality sibling is beyond the limit', () => {
    expect(isOpticalDoublePrimary(0, [0, 1], make(), ctx())).toBe(true);
  });
  it('keeps when the nearest sibling is within the limit', () => {
    const stars = make([{}, { x: 0.5 }]); // 0.5 pc apart
    expect(isOpticalDoublePrimary(0, [0, 1], stars, ctx())).toBe(false);
  });
  it('keeps when the primary is a component of a physical pair (by HIP)', () => {
    expect(isOpticalDoublePrimary(0, [0, 1], make(), ctx({ physicalHips: new Set([100]) }))).toBe(false);
  });
  it('keeps when the primary is a physical-pair member by Gaia source_id', () => {
    const stars = make([{ gaiaSourceId: 'g1' }]);
    expect(isOpticalDoublePrimary(0, [0, 1], stars, ctx({ physicalGaia: new Set(['g1']) }))).toBe(false);
  });
  it('keeps eclipsing primaries (extrinsic wings earned)', () => {
    const stars = make([{ varType: VAR_TYPE_ECLIPSING }]);
    expect(isOpticalDoublePrimary(0, [0, 1], stars, ctx())).toBe(false);
  });
  it('keeps when the primary lacks a Gaia-quality distance', () => {
    const stars = make([{ athygDistSrc: 'HIP' }]);
    expect(isOpticalDoublePrimary(0, [0, 1], stars, ctx())).toBe(false);
  });
  it('keeps when no sibling has a Gaia-quality distance to measure against', () => {
    const stars = make([{}, { x: 3, athygDistSrc: 'HIP' }]);
    expect(isOpticalDoublePrimary(0, [0, 1], stars, ctx())).toBe(false);
  });
  it('measures the NEAREST sibling — a near Gaia-quality partner keeps the wings even beside a far one', () => {
    const stars: OpticalDoubleStar[] = [
      { absmag: 0, x: 0, y: 0, z: 0, hip: 100, gaiaSourceId: null, athygDistSrc: 'G_R3', varType: 0 },
      { absmag: 1, x: 0.3, y: 0, z: 0, hip: 200, gaiaSourceId: null, athygDistSrc: 'G_R3', varType: 0 }, // bound
      { absmag: 2, x: 900, y: 0, z: 0, hip: 300, gaiaSourceId: null, athygDistSrc: 'G_R3', varType: 0 }, // background
    ];
    expect(isOpticalDoublePrimary(0, [0, 1, 2], stars, ctx())).toBe(false);
  });
});

// Pin the v5 byte layout. The writer (build-catalog.ts) and the readers
// (catalog-loader.ts, verify-catalog.ts) all index off these constants;
// drift between the two would silently produce a corrupt binary, so the
// constants themselves get the regression coverage.
describe('catalog-pure / binary-format constants', () => {
  it('header offsets are non-overlapping uint32 slots within HEADER_SIZE', () => {
    const fields = Object.entries(HEADER_LAYOUT) as [keyof typeof HEADER_LAYOUT, number][];
    for (const [name, off] of fields) {
      expect(HEADER_FIELD_SIZES[name]).toBeDefined();
      expect(off + HEADER_FIELD_SIZES[name]).toBeLessThanOrEqual(HEADER_SIZE);
    }
    // Pairwise non-overlap.
    for (let i = 0; i < fields.length; i++) {
      for (let j = i + 1; j < fields.length; j++) {
        const [na, oa] = fields[i];
        const [nb, ob] = fields[j];
        const ea = oa + HEADER_FIELD_SIZES[na];
        const eb = ob + HEADER_FIELD_SIZES[nb];
        const overlap = oa < eb && ob < ea;
        expect(overlap, `${na}@${oa}+${HEADER_FIELD_SIZES[na]} overlaps ${nb}@${ob}+${HEADER_FIELD_SIZES[nb]}`).toBe(false);
      }
    }
  });

  it('record offsets are non-overlapping and fit within RECORD_SIZE', () => {
    const fields = Object.entries(RECORD_LAYOUT) as [keyof typeof RECORD_LAYOUT, number][];
    for (const [name, off] of fields) {
      expect(RECORD_FIELD_SIZES[name]).toBeDefined();
      expect(off + RECORD_FIELD_SIZES[name]).toBeLessThanOrEqual(RECORD_SIZE);
    }
    for (let i = 0; i < fields.length; i++) {
      for (let j = i + 1; j < fields.length; j++) {
        const [na, oa] = fields[i];
        const [nb, ob] = fields[j];
        const ea = oa + RECORD_FIELD_SIZES[na];
        const eb = ob + RECORD_FIELD_SIZES[nb];
        const overlap = oa < eb && ob < ea;
        expect(overlap, `${na}@${oa}+${RECORD_FIELD_SIZES[na]} overlaps ${nb}@${ob}+${RECORD_FIELD_SIZES[nb]}`).toBe(false);
      }
    }
  });

  it('layout and size maps cover identical key sets', () => {
    expect(Object.keys(HEADER_FIELD_SIZES).sort()).toEqual(Object.keys(HEADER_LAYOUT).sort());
    expect(Object.keys(RECORD_FIELD_SIZES).sort()).toEqual(Object.keys(RECORD_LAYOUT).sort());
  });

  it('record fields tile the record contiguously (kind-derived sizes + reserved tail sum to RECORD_SIZE)', () => {
    const fields = (Object.entries(RECORD_LAYOUT) as [keyof typeof RECORD_LAYOUT, number][])
      .sort((a, b) => a[1] - b[1]);
    let expected = 0;
    for (const [name, off] of fields) {
      expect(off, `${name} leaves a gap or overlaps`).toBe(expected);
      expected = off + RECORD_FIELD_SIZES[name];
    }
    expect(expected + RECORD_RESERVED_TAIL_BYTES).toBe(RECORD_SIZE);
  });

  it('magic + version identify the v9 format', () => {
    expect(MAGIC).toBe('HYG9');
    expect(BINARY_VERSION).toBe(9);
  });

  it('record fields cover the v9 byte plan (Apsis 7×float32 at 52..79, sid uint32 at 80, velocity 3×float32 at 84..95, multiplicity uint8 at 96)', () => {
    expect(RECORD_LAYOUT.gaiaSourceId).toBe(44);
    expect(RECORD_LAYOUT.gaiaSourceId + 8).toBe(52); // gaiaSourceId end
    expect(RECORD_SIZE).toBe(100);
    // varType uint8 sits between ampUnits (36) and period (38).
    expect(RECORD_LAYOUT.ampUnits + 1).toBe(RECORD_LAYOUT.varType);
    expect(RECORD_LAYOUT.varType).toBe(37);
    expect(RECORD_LAYOUT.varType + 1).toBe(RECORD_LAYOUT.period);
    expect(RECORD_LAYOUT.period).toBe(38);
    // hip (uint32 at 40) immediately precedes gaiaSourceId.
    expect(RECORD_LAYOUT.hip + 4).toBe(RECORD_LAYOUT.gaiaSourceId);
    // Apsis bank: gspphot (4 floats) then gspspec (3 floats), each 4 bytes,
    // starting immediately after gaiaSourceId at byte 52 and filling the
    // record to RECORD_SIZE.
    expect(RECORD_LAYOUT.teffGspphot).toBe(52);
    expect(RECORD_LAYOUT.loggGspphot).toBe(56);
    expect(RECORD_LAYOUT.mhGspphot).toBe(60);
    expect(RECORD_LAYOUT.azeroGspphot).toBe(64);
    expect(RECORD_LAYOUT.teffGspspec).toBe(68);
    expect(RECORD_LAYOUT.loggGspspec).toBe(72);
    expect(RECORD_LAYOUT.mhGspspec).toBe(76);
    // sid uint32 immediately after the Apsis bank, then the velocity bank.
    expect(RECORD_LAYOUT.mhGspspec + 4).toBe(RECORD_LAYOUT.sid);
    expect(RECORD_LAYOUT.sid).toBe(80);
    // v8 velocity bank: 3 float32 pc/yr appended after sid.
    expect(RECORD_LAYOUT.sid + 4).toBe(RECORD_LAYOUT.vx);
    expect(RECORD_LAYOUT.vx).toBe(84);
    expect(RECORD_LAYOUT.vy).toBe(88);
    expect(RECORD_LAYOUT.vz).toBe(92);
    // v9 multiplicity uint8 after the velocity bank; the reserved tail pads
    // the stride back to a multiple of 4.
    expect(RECORD_LAYOUT.vz + 4).toBe(RECORD_LAYOUT.multiplicityStatus);
    expect(RECORD_LAYOUT.multiplicityStatus).toBe(96);
    expect(RECORD_LAYOUT.multiplicityStatus + 1 + RECORD_RESERVED_TAIL_BYTES).toBe(RECORD_SIZE);
    expect(RECORD_SIZE % 4).toBe(0);
  });

  it('multiplicity enum values are distinct and fit the uint8 field', () => {
    const values = [MULTIPLICITY_SINGLE, MULTIPLICITY_RESOLVED, MULTIPLICITY_UNRESOLVED];
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xff);
    }
    expect(MULTIPLICITY_SINGLE).toBe(0); // zero-fill default = single
  });

  it('FLAGS registry entries are distinct single-bit values', () => {
    const values = Object.values(FLAGS);
    for (const f of values) {
      expect(f).toBeGreaterThan(0);
      expect(f & (f - 1)).toBe(0); // single-bit
    }
    expect(new Set(values).size).toBe(values.length);
  });

  it('FLAG_* aliases match the FLAGS registry', () => {
    expect(FLAG_HAS_NAME).toBe(FLAGS.hasName);
    expect(FLAG_IS_SOL).toBe(FLAGS.isSol);
    expect(FLAG_HAS_BAYER).toBe(FLAGS.hasBayer);
    expect(FLAG_BINARY_COMPANION_ONLY).toBe(FLAGS.binaryCompanionOnly);
    expect(FLAG_BINARY_PRIMARY).toBe(FLAGS.binaryPrimary);
    expect(FLAG_BINARY_COMPANION_SYNTHETIC).toBe(FLAGS.binaryCompanionSynthetic);
  });

  it('RESERVED_FLAG_BITS does not collide with any registered FLAGS value', () => {
    for (const v of Object.values(FLAGS)) {
      expect(v & RESERVED_FLAG_BITS, `FLAGS value 0x${v.toString(16)} collides with RESERVED_FLAG_BITS`).toBe(0);
    }
  });

  it('reserved + used flag bits stay within the uint8 envelope', () => {
    const used = Object.values(FLAGS).reduce((acc, v) => acc | v, 0);
    expect((used | RESERVED_FLAG_BITS) & ~0xff).toBe(0);
  });

  it('name-table layout is two zero padding bytes + (uint16 len, utf-8 bytes) entries', () => {
    expect(NAME_TABLE_PADDING).toBe(2);
    expect(NAME_LENGTH_PREFIX_BYTES).toBe(2);
    // Round-trip a writer-shaped table inline and verify the reader's
    // pointer-walk lands on the right names. Pins the contract without
    // depending on build-catalog.ts or catalog-loader.ts.
    const encoder = new TextEncoder();
    const names = ['Sol', 'α Cen', '日本']; // ascii + 2-byte + 3-byte UTF-8
    const chunks: Uint8Array[] = [new Uint8Array(NAME_TABLE_PADDING)];
    let len = NAME_TABLE_PADDING;
    const expectedOffsets: number[] = [];
    for (const n of names) {
      const bytes = encoder.encode(n);
      expectedOffsets.push(len);
      const lenHeader = new Uint8Array(NAME_LENGTH_PREFIX_BYTES);
      new DataView(lenHeader.buffer).setUint16(0, bytes.length, true);
      chunks.push(lenHeader);
      chunks.push(bytes);
      len += NAME_LENGTH_PREFIX_BYTES + bytes.length;
    }
    const table = new Uint8Array(len);
    let p = 0;
    for (const c of chunks) { table.set(c, p); p += c.length; }
    // Sentinel padding is zero.
    for (let i = 0; i < NAME_TABLE_PADDING; i++) expect(table[i]).toBe(0);
    // Reader walk — the shared decode both readers use.
    const recovered = readNameTable(table.buffer, 0, len);
    expect([...recovered.values()]).toEqual(names);
    expect([...recovered.keys()]).toEqual(expectedOffsets);
    expect(recovered.has(0)).toBe(false); // offset 0 stays the no-name sentinel
  });
});

describe('catalog-pure / record reader surface', () => {
  const DISTINCT: WireStarRecord = {
    x: 1.5, y: -2.25, z: 3.125,
    vx: 1e-5, vy: -2e-5, vz: 3e-5,
    absmag: -1.75, ci: 0.5, physRadius: 12.5,
    companionIdx: 4242, nameOffset: 18,
    spectClass: 3, lumClass: 4, conIndex: 87, flags: 0x15,
    ampUnits: 200, periodUnits: 40_000, varType: VAR_TYPE_ECLIPSING,
    hip: 120_404, gaiaSourceId: 4_658_107_884_688_023_040n,
    apsis: {
      teffGspphot: 5772, loggGspphot: 4.44, mhGspphot: -0.5, azeroGspphot: 0.25,
      teffGspspec: 5800, loggGspspec: 4.5, mhGspspec: 0.1,
    },
    sid: 99_999,
    multiplicityStatus: MULTIPLICITY_RESOLVED,
  };

  function writeOne(record: WireStarRecord, count = 1): DataView {
    const view = new DataView(new ArrayBuffer(HEADER_SIZE + count * RECORD_SIZE));
    for (let i = 0; i < count; i++) writeStarRecord(view, HEADER_SIZE + i * RECORD_SIZE, record);
    return view;
  }

  it('reads back every field writeStarRecord emits', () => {
    const view = writeOne(DISTINCT);
    const off = HEADER_SIZE;
    expect(readRecordField(view, off, 'x')).toBeCloseTo(DISTINCT.x, 5);
    expect(readRecordField(view, off, 'vy')).toBeCloseTo(DISTINCT.vy, 10);
    expect(readRecordField(view, off, 'absmag')).toBeCloseTo(DISTINCT.absmag, 5);
    expect(readRecordField(view, off, 'companion')).toBe(DISTINCT.companionIdx);
    expect(readRecordField(view, off, 'nameOffset')).toBe(DISTINCT.nameOffset);
    expect(readRecordField(view, off, 'conIndex')).toBe(DISTINCT.conIndex);
    expect(readRecordField(view, off, 'flags')).toBe(DISTINCT.flags);
    expect(readRecordField(view, off, 'ampUnits')).toBe(DISTINCT.ampUnits);
    expect(readRecordField(view, off, 'period')).toBe(DISTINCT.periodUnits);
    expect(readRecordField(view, off, 'varType')).toBe(DISTINCT.varType);
    expect(readRecordField(view, off, 'hip')).toBe(DISTINCT.hip);
    expect(readRecordField(view, off, 'sid')).toBe(DISTINCT.sid);
    expect(readRecordField(view, off, 'multiplicityStatus')).toBe(DISTINCT.multiplicityStatus);
    expect(readRecordFieldBig(view, off, 'gaiaSourceId')).toBe(DISTINCT.gaiaSourceId);
  });

  it('every numeric field reads through the getter its declared kind implies', () => {
    // A u8 field read as u16 (or an f32 read as u32) would return a value
    // outside the kind's range or a NaN-shaped float; walking every field
    // catches a LAYOUT/KINDS pair that drifted apart.
    const view = writeOne(DISTINCT);
    for (const [field, kind] of Object.entries(RECORD_FIELD_KINDS)) {
      if (kind === 'u64') continue;
      const v = readRecordField(view, HEADER_SIZE, field as NumericRecordField);
      expect(Number.isFinite(v), `${field} decoded as ${v}`).toBe(true);
      if (kind === 'u8') expect(v, field).toBeLessThanOrEqual(0xff);
      if (kind === 'u16') expect(v, field).toBeLessThanOrEqual(0xffff);
      if (kind === 'u32') expect(v, field).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('decodeRecordColumn agrees with readRecordField field for field', () => {
    const count = 4;
    const view = writeOne(DISTINCT, count);
    for (const [field, kind] of Object.entries(RECORD_FIELD_KINDS)) {
      if (kind === 'u64') continue;
      const out = new Float32Array(count);
      decodeRecordColumn(view, count, field as NumericRecordField, out);
      for (let i = 0; i < count; i++) {
        const scalar = readRecordField(view, HEADER_SIZE + i * RECORD_SIZE, field as NumericRecordField);
        expect(out[i], `${field}[${i}]`).toBe(Math.fround(scalar));
      }
    }
    const big = new BigUint64Array(count);
    decodeRecordColumnBig(view, count, 'gaiaSourceId', big);
    expect([...big]).toEqual(Array(count).fill(DISTINCT.gaiaSourceId));
  });

  it('decodeRecordColumn interleaves a triple at the given stride + component', () => {
    const count = 3;
    const view = writeOne(DISTINCT, count);
    const positions = new Float32Array(count * 3);
    decodeRecordColumn(view, count, 'x', positions, { stride: 3, component: 0 });
    decodeRecordColumn(view, count, 'y', positions, { stride: 3, component: 1 });
    decodeRecordColumn(view, count, 'z', positions, { stride: 3, component: 2 });
    for (let i = 0; i < count; i++) {
      expect(positions[i * 3 + 0]).toBeCloseTo(DISTINCT.x, 5);
      expect(positions[i * 3 + 1]).toBeCloseTo(DISTINCT.y, 5);
      expect(positions[i * 3 + 2]).toBeCloseTo(DISTINCT.z, 5);
    }
  });

  it('scale de-quantises the amplitude + period bytes back to physical units', () => {
    const view = writeOne(DISTINCT);
    const amp = new Float32Array(1);
    const period = new Float32Array(1);
    decodeRecordColumn(view, 1, 'ampUnits', amp, { scale: AMP_MAG_PER_UNIT });
    decodeRecordColumn(view, 1, 'period', period, { scale: PERIOD_DAYS_PER_UNIT });
    expect(amp[0]).toBeCloseTo(10, 6);      // 200 × 0.05 mag
    expect(period[0]).toBeCloseTo(4000, 3); // 40000 × 0.1 d
  });

  it('the quantisation steps are the exact inverse of the encoders', () => {
    // AMP_MAG_PER_UNIT / PERIOD_DAYS_PER_UNIT are the decode-side spelling
    // of encodeAmpUnits / encodePeriodUnits' factors; a drift in either
    // silently rescales every shipped variability value.
    for (const mag of [0, 0.05, 0.35, 1.2, 9.4, 12.75]) {
      expect(encodeAmpUnits(mag) * AMP_MAG_PER_UNIT).toBeCloseTo(mag, 10);
    }
    for (const days of [0, 0.1, 4.4, 146.5, 409.2, 6553.5]) {
      expect(encodePeriodUnits(days) * PERIOD_DAYS_PER_UNIT).toBeCloseTo(days, 10);
    }
  });

  it('readCatalogHeader returns the written header and rejects foreign buffers', () => {
    const buffer = new ArrayBuffer(HEADER_SIZE);
    writeCatalogHeader(new DataView(buffer), {
      count: 7, nameTableOffset: 32, nameTableLength: 2,
    });
    expect(readCatalogHeader(buffer)).toEqual({
      magic: MAGIC,
      version: BINARY_VERSION,
      count: 7,
      nameTableOffset: 32,
      nameTableLength: 2,
    });

    const badMagic = new ArrayBuffer(HEADER_SIZE);
    new Uint8Array(badMagic).set([0x4e, 0x4f, 0x50, 0x45]); // "NOPE"
    expect(() => readCatalogHeader(badMagic)).toThrow(/Bad magic/);

    const oldVersion = new ArrayBuffer(HEADER_SIZE);
    writeCatalogHeader(new DataView(oldVersion), {
      count: 1, nameTableOffset: 32, nameTableLength: 0,
    });
    new DataView(oldVersion).setUint32(HEADER_LAYOUT.version, BINARY_VERSION - 1, true);
    expect(() => readCatalogHeader(oldVersion)).toThrow(/Unsupported catalog version/);
  });
});

describe('catalog-pure / search-index wire contract', () => {
  // The SearchEntry field names ARE the on-disk keys of search-index.json.
  // buildSearchEntry (writer) and src/client/typeahead/search.ts (reader)
  // share the type, so tsc keeps their field access in lockstep — but
  // main.ts ingests the file through an unchecked `as SearchEntry[]` cast,
  // so a rename silently reshapes the persisted wire format (breaking any
  // cached index / external consumer) with no red test. Pin the literal
  // key strings so a rename trips here, mirroring the binary
  // record-layout pin above.
  const SEARCH_ENTRY_KEYS = [
    'i', 'p', 'b', 'f', 'c', 'dc', 's', 'g', 'hip', 'hd', 'hr', 'gl', 'cl', 'cp',
  ];

  it('SearchEntry exposes exactly the documented wire keys', () => {
    // Excess-property checking makes a renamed or dropped interface key a
    // compile error on this literal; the runtime assertion pins the names.
    const full: Required<SearchEntry> = {
      i: 0, p: 'Sirius', b: 'Alp', f: 9, c: 34, dc: 3, s: 'A1V', g: 'R CrB',
      hip: 32349, hd: 48915, hr: 2491, gl: 'GJ 244', cl: 'B', cp: 5,
    };
    expect(Object.keys(full).sort()).toEqual([...SEARCH_ENTRY_KEYS].sort());
  });

  const source = (over: Partial<SearchEntrySource>): SearchEntrySource => ({
    proper: null, bayer: null, flam: null, hip: null, hd: null, hr: null,
    gl: null, gcvsName: null, conIndex: NO_CONSTELLATION_INDEX,
    desigConIndex: NO_CONSTELLATION_INDEX, spectDisplay: null, ...over,
  });

  it('buildSearchEntry emits every populated wire key', () => {
    const entry = buildSearchEntry(
      source({
        proper: 'Sirius', bayer: 'Alp', flam: 9, hip: 32349, hd: 48915,
        hr: 2491, gl: 'GJ 244', gcvsName: 'R CrB', conIndex: 34,
        desigConIndex: 3, spectDisplay: 'A1V',
      }),
      0,
      { comp: 'B', primaryIdx: 5 },
    );
    expect(entry).not.toBeNull();
    expect(Object.keys(entry as SearchEntry).sort())
      .toEqual([...SEARCH_ENTRY_KEYS].sort());
  });

  it('buildSearchEntry omits absent fields — no null/undefined on the wire', () => {
    const entry = buildSearchEntry(source({ hip: 7 }), 3, undefined);
    expect(JSON.parse(JSON.stringify(entry))).toEqual({ i: 3, hip: 7 });
    expect(Object.keys(entry as SearchEntry)).toEqual(['i', 'hip']);
  });

  it('buildSearchEntry drops the unclassified constellation sentinel', () => {
    const entry = buildSearchEntry(
      source({ hip: 7, conIndex: NO_CONSTELLATION_INDEX }), 0, undefined,
    );
    expect(entry).not.toHaveProperty('c');
  });

  it('buildSearchEntry returns null for a star with no typable identifier', () => {
    expect(buildSearchEntry(source({ conIndex: 34 }), 0, undefined)).toBeNull();
  });

  it('buildSearchEntry emits dc only where the designation constellation differs', () => {
    // Agreeing (the overwhelming majority) and unknown-designation records
    // both ride the reader's `dc ?? c` fallback, so neither pays wire cost.
    const agreeing = buildSearchEntry(
      source({ flam: 67, conIndex: 34, desigConIndex: 34 }), 0, undefined,
    );
    expect(agreeing).not.toHaveProperty('dc');
    const unknown = buildSearchEntry(
      source({ flam: 67, conIndex: 34, desigConIndex: NO_CONSTELLATION_INDEX }), 0, undefined,
    );
    expect(unknown).not.toHaveProperty('dc');
    // ρ Aql's shape: positional Delphinus, designation Aquila.
    const diverging = buildSearchEntry(
      source({ bayer: 'Rho', flam: 67, hip: 99742, conIndex: 31, desigConIndex: 3 }),
      0, undefined,
    );
    expect(diverging?.c).toBe(31);
    expect(diverging?.dc).toBe(3);
  });

  it('buildSearchEntry withholds dc from an entry with no constellation-relative designation', () => {
    // A star findable only by HIP/HD/HR/Gl never renders "<designation>
    // <Con>", so carrying the field would be 60-odd bytes of wire for a
    // reader that cannot consult it.
    const byNumber = buildSearchEntry(
      source({ hip: 7, hd: 9, conIndex: 31, desigConIndex: 3 }), 0, undefined,
    );
    expect(byNumber).not.toHaveProperty('dc');
    // A component alias composes "<primary designation> <letter>" against
    // this entry's constellation, so it does need it (Fomalhaut C sits in
    // Aquarius but is "α PsA C").
    const component = buildSearchEntry(
      source({ proper: 'Fomalhaut C', conIndex: 4, desigConIndex: 65 }),
      0, { comp: 'C', primaryIdx: 5 },
    );
    expect(component?.dc).toBe(65);
  });

  it('designationConIndex prefers the editorial index and falls back to the positional one', () => {
    expect(designationConIndex(3, 31)).toBe(3);
    expect(designationConIndex(NO_CONSTELLATION_INDEX, 31)).toBe(31);
    expect(designationConIndex(undefined, 31)).toBe(31);
    expect(designationConIndex(undefined, undefined)).toBe(NO_CONSTELLATION_INDEX);
  });
});

// ─── Bailer-Jones (DR3) distance override ──────────────────────────────

describe('catalog-pure / parseBailerJonesTsv', () => {
  it('parses source_id as string and prefers r_med_photogeo', () => {
    const tsv =
      'source_id\tr_med_geo\tr_lo_geo\tr_hi_geo\tr_med_photogeo\tr_lo_photogeo\tr_hi_photogeo\tflag\n' +
      '204531088580182016\t6366.668\t6300\t6420\t6244.791\t6200\t6280\t10033\n' +
      '4773096563064098432\t93.528\t92\t94\t92.871\t92\t93\t10023\n';
    const map = parseBailerJonesTsv(tsv);
    expect(map.size).toBe(2);
    expect(map.get('204531088580182016')).toBe(6244.791);
    expect(map.get('4773096563064098432')).toBe(92.871);
  });

  it('falls back to r_med_geo when r_med_photogeo is empty', () => {
    const tsv =
      'source_id\tr_med_geo\tr_lo_geo\tr_hi_geo\tr_med_photogeo\tr_lo_photogeo\tr_hi_photogeo\tflag\n' +
      '123\t250.0\t245\t255\t\t\t\t33333\n';
    const map = parseBailerJonesTsv(tsv);
    expect(map.get('123')).toBe(250.0);
  });

  it('throws on missing required columns', () => {
    expect(() => parseBailerJonesTsv('source_id\tr_med_geo\n1\t10\n'))
      .toThrow(/r_med_photogeo/);
  });

  it('skips rows with non-positive distance and blank source_ids', () => {
    const tsv =
      'source_id\tr_med_geo\tr_lo_geo\tr_hi_geo\tr_med_photogeo\tr_lo_photogeo\tr_hi_photogeo\tflag\n' +
      '\t10\t9\t11\t10\t9\t11\t1\n' +
      '999\t-1\t-1\t-1\t\t\t\t1\n' +
      '111\t100\t99\t101\t99\t98\t100\t1\n';
    const map = parseBailerJonesTsv(tsv);
    expect(map.size).toBe(1);
    expect(map.get('111')).toBe(99);
  });
});

describe('catalog-pure / parseGaiaApsisTsv', () => {
  const HDR =
    'source_id\tteff_gspphot\tlogg_gspphot\tmh_gspphot\tazero_gspphot\t' +
    'teff_gspspec\tlogg_gspspec\tmh_gspspec\tspectraltype_esphs\n';

  it('parses source_id as string, both gspphot and gspspec triples, plus the esphs enum', () => {
    const tsv = HDR +
      '7632157690368\t5028.8\t3.1614\t-0.1016\t0.2131\t4864.0\t2.6600\t-0.2000\tK\n' +
      '44358422235136\t5787.8\t4.3140\t0.3385\t0.0648\t\t\t\tG\n';
    const map = parseGaiaApsisTsv(tsv);
    expect(map.size).toBe(2);
    const a = map.get('7632157690368')!;
    expect(a.teffGspphot).toBe(5028.8);
    expect(a.loggGspphot).toBe(3.1614);
    expect(a.mhGspphot).toBe(-0.1016);
    expect(a.azeroGspphot).toBe(0.2131);
    expect(a.teffGspspec).toBe(4864.0);
    expect(a.loggGspspec).toBe(2.6600);
    expect(a.mhGspspec).toBe(-0.2000);
    expect(a.spectraltypeEsphs).toBe('K');
    const b = map.get('44358422235136')!;
    expect(b.teffGspphot).toBe(5787.8);
    expect(b.teffGspspec).toBeNull();
    expect(b.loggGspspec).toBeNull();
    expect(b.mhGspspec).toBeNull();
    expect(b.spectraltypeEsphs).toBe('G');
  });

  it('decodes blank cells as null without dropping the row', () => {
    const tsv = HDR + '999\t\t\t\t\t6000\t4.0\t0.0\t\n';
    const map = parseGaiaApsisTsv(tsv);
    const r = map.get('999')!;
    expect(r.teffGspphot).toBeNull();
    expect(r.loggGspphot).toBeNull();
    expect(r.mhGspphot).toBeNull();
    expect(r.azeroGspphot).toBeNull();
    expect(r.teffGspspec).toBe(6000);
    expect(r.loggGspspec).toBe(4.0);
    expect(r.mhGspspec).toBe(0.0);
    expect(r.spectraltypeEsphs).toBeNull();
  });

  it('skips rows with a blank source_id', () => {
    const tsv = HDR + '\t5000\t4\t0\t0\t5000\t4\t0\tG\n';
    const map = parseGaiaApsisTsv(tsv);
    expect(map.size).toBe(0);
  });

  it('throws on missing required columns', () => {
    expect(() => parseGaiaApsisTsv('source_id\tteff_gspphot\n1\t5000\n'))
      .toThrow(/azero_gspphot|logg_gspphot|mh_gspphot|teff_gspspec|spectraltype_esphs/);
  });
});

describe('catalog-pure / NO_APSIS sentinel', () => {
  it('is NaN, distinguishable from every finite Apsis value', () => {
    expect(Number.isNaN(NO_APSIS)).toBe(true);
  });

  it('round-trips through Float32 DataView as NaN', () => {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setFloat32(0, NO_APSIS, true);
    expect(Number.isNaN(view.getFloat32(0, true))).toBe(true);
  });

  it('finite values survive Float32 round-trip without becoming the sentinel', () => {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    // Pick values from the bead spec's spot-check stars (Sirius-region
    // Teff ~10000K, K-dwarf logg ~4.5, halo [M/H] ~-1.5, mild A0 ~0.2).
    for (const v of [10000.0, 4.5, -1.5, 0.2]) {
      view.setFloat32(0, v, true);
      const r = view.getFloat32(0, true);
      expect(Number.isNaN(r)).toBe(false);
      expect(r).toBeCloseTo(v, 3);
    }
  });
});

describe('catalog-pure / apparentToAbsoluteMagnitude', () => {
  it('is identity at 10 pc', () => {
    expect(apparentToAbsoluteMagnitude(5.0, 10)).toBe(5.0);
  });

  it('M = m − 5·log₁₀(d/10)', () => {
    // 100 pc is 5 magnitudes dimmer than 10 pc.
    expect(apparentToAbsoluteMagnitude(15, 100)).toBeCloseTo(10, 10);
    // 1000 pc is 10 magnitudes dimmer than 10 pc.
    expect(apparentToAbsoluteMagnitude(20, 1000)).toBeCloseTo(10, 10);
  });
});

describe('catalog-pure / buildDistanceOverride', () => {
  it('threads dist into the result', () => {
    expect(buildDistanceOverride(10, 250).dist).toBe(250);
  });

  it('uses the same absmag formula as apparentToAbsoluteMagnitude', () => {
    expect(buildDistanceOverride(12.029, LMC_DISTANCE_PC).absmag)
      .toBe(apparentToAbsoluteMagnitude(12.029, LMC_DISTANCE_PC));
  });
});

describe('catalog-pure / applyBailerJonesOverride', () => {
  // Tier-A fixtures: real AT-HYG + Bailer-Jones DR3 values for the
  // four catastrophic parallax-inversion supergiants and a
  // well-measured F-dwarf control. Numbers pin the override outcome:
  // drift here means the override changed semantics or the upstream
  // catalogues drifted.
  interface Fixture {
    label: string;
    ra: number; dec: number; mag: number; sourceId: string;
    athygDist: number;       // AT-HYG dist (pre-override)
    bjDist: number;          // r_med_photogeo from data/bailer-jones-dr3.tsv
  }
  const FIVE_HIPS: Fixture[] = [
    { label: 'HIP 22365', ra: 4.81481859, dec:  43.27557981, mag:  7.7,  sourceId: '204531088580182016', athygDist:  9963.4514, bjDist: 6244.791 },
    { label: 'HIP 25733', ra: 5.49517982, dec:  35.37501942, mag:  6.78, sourceId: '183255985260080896', athygDist: 14326.6476, bjDist: 5466.246 },
    { label: 'HIP 38430', ra: 7.87230124, dec: -26.42963691, mag:  9.19, sourceId: '5602025904044961536', athygDist: 12658.2278, bjDist: 6215.232 },
    { label: 'HIP 46144', ra: 9.41038175, dec:  62.43823034, mag: 10.14, sourceId: '1040043514891491968', athygDist:  9189.7878, bjDist: 7515.496 },
    { label: 'HIP 23785', ra: 5.11164486, dec: -50.94139857, mag:  8.39, sourceId: '4773096563064098432', athygDist:    93.1801, bjDist:   92.871 },
  ];
  const bjMap = new Map(FIVE_HIPS.map((f) => [f.sourceId, f.bjDist] as const));

  it('returns null when source_id is missing or absent from the map', () => {
    expect(applyBailerJonesOverride(10, null, bjMap)).toBeNull();
    expect(applyBailerJonesOverride(10, '', bjMap)).toBeNull();
    expect(applyBailerJonesOverride(10, '0000', bjMap)).toBeNull();
  });

  it('pins the BJ distance', () => {
    for (const f of FIVE_HIPS) {
      const out = applyBailerJonesOverride(f.mag, f.sourceId, bjMap);
      expect(out, f.label).not.toBeNull();
      expect(out!.dist, f.label).toBe(f.bjDist);
    }
  });

  it('pulls the three highest-S/N supergiants back by 37%-62%', () => {
    // HIP 22365 / 25733 / 38430 are the showcase catastrophic-parallax
    // pullbacks (37%, 62%, 51%). HIP 46144 is the fourth flagged outlier
    // but only drops 18% — the test caps at three for the ≥25% headline,
    // and HIP 46144's pullback is asserted separately below.
    for (const label of ['HIP 22365', 'HIP 25733', 'HIP 38430']) {
      const f = FIVE_HIPS.find((x) => x.label === label)!;
      const out = applyBailerJonesOverride(f.mag, f.sourceId, bjMap)!;
      const drop = (f.athygDist - out.dist) / f.athygDist;
      expect(drop, `${label} drop ratio`).toBeGreaterThan(0.25);
    }
  });

  it('HIP 46144 pulls back ~18% (lower-S/N outlier)', () => {
    const f = FIVE_HIPS.find((x) => x.label === 'HIP 46144')!;
    const out = applyBailerJonesOverride(f.mag, f.sourceId, bjMap)!;
    const drop = (f.athygDist - out.dist) / f.athygDist;
    expect(drop).toBeGreaterThan(0.15);
    expect(drop).toBeLessThan(0.20);
  });

  it('leaves the well-measured F-dwarf HIP 23785 within 5%', () => {
    const f = FIVE_HIPS.find((x) => x.label === 'HIP 23785')!;
    const out = applyBailerJonesOverride(f.mag, f.sourceId, bjMap)!;
    expect(Math.abs(f.athygDist - out.dist) / f.athygDist).toBeLessThan(0.05);
  });

});

describe('catalog-pure / isBailerJonesEligible', () => {
  it('admits only Gaia-inverse dist_src values when a source_id is present', () => {
    expect(isBailerJonesEligible('123', 'G_R3')).toBe(true);
    expect(isBailerJonesEligible('123', 'G_R2')).toBe(true);
    expect(isBailerJonesEligible('123', 'HIP')).toBe(false);
    expect(isBailerJonesEligible('123', 'GJ')).toBe(false);
    expect(isBailerJonesEligible('123', 'N')).toBe(false);
    expect(isBailerJonesEligible('123', 'OTHER')).toBe(false);
  });

  it('rejects rows without a Gaia source_id even if dist_src is Gaia-inverse', () => {
    expect(isBailerJonesEligible(null, 'G_R3')).toBe(false);
    expect(isBailerJonesEligible('', 'G_R3')).toBe(false);
  });

  it('rejects rows without a dist_src even if a source_id is present', () => {
    expect(isBailerJonesEligible('123', null)).toBe(false);
    expect(isBailerJonesEligible('123', '')).toBe(false);
  });

  it('BJ_ELIGIBLE_DIST_SRCS is exactly {G_R3, G_R2} — guards against namespace drift', () => {
    expect(BJ_ELIGIBLE_DIST_SRCS.size).toBe(2);
    expect(BJ_ELIGIBLE_DIST_SRCS.has('G_R3')).toBe(true);
    expect(BJ_ELIGIBLE_DIST_SRCS.has('G_R2')).toBe(true);
    expect(BJ_ELIGIBLE_DIST_SRCS.has('HIP')).toBe(false);
  });
});

describe('catalog-pure / dist_src partition', () => {
  it('DIST_SRC_BUCKETS covers AT-HYG v3.3 dist_src plus the catch-all', () => {
    expect([...DIST_SRC_BUCKETS]).toEqual([
      'G_R3', 'G_R2', 'HIP', 'GJ', 'N', 'OTHER', 'UNRECOGNISED',
    ]);
    expect([...BJ_ELIGIBLE_DIST_SRCS].every(
      (s) => (DIST_SRC_BUCKETS as readonly string[]).includes(s),
    )).toBe(true);
  });

  it('buckets each AT-HYG dist_src under its own name', () => {
    for (const src of ['G_R3', 'G_R2', 'HIP', 'GJ', 'N', 'OTHER']) {
      expect(distSrcBucket(src), src).toBe(src);
    }
  });

  it('routes a null, blank, or never-seen dist_src to UNRECOGNISED', () => {
    // Keeps a newly-introduced AT-HYG dist_src from hiding inside the
    // literal 'OTHER' bucket, where no override layer has reasoned about it.
    expect(distSrcBucket(null)).toBe('UNRECOGNISED');
    expect(distSrcBucket('')).toBe('UNRECOGNISED');
    expect(distSrcBucket('G_R4')).toBe('UNRECOGNISED');
  });

  it('emptyDistSrcPartition zeroes every bucket', () => {
    const p = emptyDistSrcPartition();
    expect(Object.keys(p)).toEqual([...DIST_SRC_BUCKETS]);
    expect(Object.values(p).every((n) => n === 0)).toBe(true);
  });

  it('tallyDistSrc accumulates per bucket and leaves the rest at zero', () => {
    const p = emptyDistSrcPartition();
    tallyDistSrc(p, 'G_R3');
    tallyDistSrc(p, 'G_R3');
    tallyDistSrc(p, 'HIP');
    tallyDistSrc(p, 'G_R4');
    expect(p.G_R3).toBe(2);
    expect(p.HIP).toBe(1);
    expect(p.UNRECOGNISED).toBe(1);
    expect(p.G_R2).toBe(0);
    expect(p.GJ).toBe(0);
    expect(p.N).toBe(0);
    expect(p.OTHER).toBe(0);
  });
});

describe('catalog-pure / parseGaiaSourceIdStr', () => {
  it('returns the trimmed decimal string for a valid Gaia source_id', () => {
    expect(parseGaiaSourceIdStr('5877748442128924544')).toBe('5877748442128924544');
    expect(parseGaiaSourceIdStr('  5877748442128924544  ')).toBe('5877748442128924544');
  });

  it('preserves digits beyond 2^53 verbatim (never coerces to Number)', () => {
    // The whole point: a value above 2^53 would lose bits if parsed
    // numerically. Round-trip via BigInt to prove the string is BigInt-safe.
    const raw = '9876543210123456789';
    const parsed = parseGaiaSourceIdStr(raw);
    expect(parsed).toBe(raw);
    expect(BigInt(parsed!).toString()).toBe(raw);
  });

  it('returns null for null / undefined / empty / whitespace-only inputs', () => {
    expect(parseGaiaSourceIdStr(null)).toBeNull();
    expect(parseGaiaSourceIdStr(undefined)).toBeNull();
    expect(parseGaiaSourceIdStr('')).toBeNull();
    expect(parseGaiaSourceIdStr('   ')).toBeNull();
  });

  it('returns null for non-decimal cells so BigInt() never sees garbage', () => {
    // BigInt('abc') throws SyntaxError; the gate above must catch
    // anything that isn't pure decimal digits before it gets there.
    expect(parseGaiaSourceIdStr('abc')).toBeNull();
    expect(parseGaiaSourceIdStr('123abc')).toBeNull();
    expect(parseGaiaSourceIdStr('1.23')).toBeNull();
    expect(parseGaiaSourceIdStr('-123')).toBeNull();
    expect(parseGaiaSourceIdStr('+123')).toBeNull();
    expect(parseGaiaSourceIdStr('1e9')).toBeNull();
    expect(parseGaiaSourceIdStr('0x1234')).toBeNull();
  });
});

describe('catalog-pure / resolveGaiaSourceId', () => {
  const map = new Map<number, string>([
    [2, '2341871673090078592'],
    [3, '2881742980523997824'],
  ]);

  it('returns AT-HYG native source_id untouched (precedence over cross-walk)', () => {
    expect(resolveGaiaSourceId('999', 2, map)).toEqual({
      gaiaSourceId: '999',
      backfilled: false,
      magRejected: false,
      siblingRejected: false,
    });
  });

  it('backfills from HIP cross-walk when AT-HYG gaia is null', () => {
    expect(resolveGaiaSourceId(null, 2, map)).toEqual({
      gaiaSourceId: '2341871673090078592',
      backfilled: true,
      magRejected: false,
      siblingRejected: false,
    });
  });

  it('returns null when HIP is absent (no cross-walk key available)', () => {
    expect(resolveGaiaSourceId(null, null, map)).toEqual({
      gaiaSourceId: null,
      backfilled: false,
      magRejected: false,
      siblingRejected: false,
    });
  });

  it('returns null when HIP is not in the cross-walk (Gaia-saturated bright stars)', () => {
    // Sirius (HIP 32349), Vega (91262), Procyon (37279) etc. are absent
    // from `hipparcos2_best_neighbour` — they stay unresolved here.
    expect(resolveGaiaSourceId(null, 32349, map)).toEqual({
      gaiaSourceId: null,
      backfilled: false,
      magRejected: false,
      siblingRejected: false,
    });
  });

  it('returns null when the HIP cross-walk itself is null (build without xmatch file)', () => {
    expect(resolveGaiaSourceId(null, 2, null)).toEqual({
      gaiaSourceId: null,
      backfilled: false,
      magRejected: false,
      siblingRejected: false,
    });
  });

  it('rejects non-positive HIP values', () => {
    expect(resolveGaiaSourceId(null, 0, map)).toEqual({
      gaiaSourceId: null,
      backfilled: false,
      magRejected: false,
      siblingRejected: false,
    });
    expect(resolveGaiaSourceId(null, -1, map)).toEqual({
      gaiaSourceId: null,
      backfilled: false,
      magRejected: false,
      siblingRejected: false,
    });
  });
});

describe('catalog-pure / resolveGaiaSourceId magnitude gate', () => {
  const gMags = new Map<string, number>([
    ['5877748442128924544', 20.95], // Toliman's wrong background binding
    ['777', 1.6],
  ]);
  const gMagOf = (id: string) => gMags.get(id) ?? null;

  it('scrubs a native binding fainter in G than V beyond the gate (Toliman)', () => {
    expect(
      resolveGaiaSourceId('5877748442128924544', null, null, 1.33, gMagOf),
    ).toEqual({ gaiaSourceId: null, backfilled: false, magRejected: true, siblingRejected: false });
  });

  it('keeps a native binding consistent with V', () => {
    expect(resolveGaiaSourceId('777', null, null, 1.58, gMagOf)).toEqual({
      gaiaSourceId: '777', backfilled: false, magRejected: false,
      siblingRejected: false,
    });
  });

  it('scrubs a cross-walk hit that fails the gate', () => {
    const xmap = new Map<number, string>([[71681, '5877748442128924544']]);
    expect(resolveGaiaSourceId(null, 71681, xmap, 1.33, gMagOf)).toEqual({
      gaiaSourceId: null, backfilled: false, magRejected: true,
      siblingRejected: false,
    });
  });

  it('falls through from a rejected native cell to a passing cross-walk hit', () => {
    const xmap = new Map<number, string>([[1, '777']]);
    expect(
      resolveGaiaSourceId('5877748442128924544', 1, xmap, 1.58, gMagOf),
    ).toEqual({ gaiaSourceId: '777', backfilled: true, magRejected: true, siblingRejected: false });
  });

  it('passes ungated without a G magnitude or a V magnitude', () => {
    expect(resolveGaiaSourceId('12345', null, null, 1.0, gMagOf)).toEqual({
      gaiaSourceId: '12345', backfilled: false, magRejected: false,
      siblingRejected: false,
    });
    expect(
      resolveGaiaSourceId('5877748442128924544', null, null, null, gMagOf),
    ).toEqual({
      gaiaSourceId: '5877748442128924544', backfilled: false, magRejected: false,
      siblingRejected: false,
    });
  });

  it('matches the binaries pipeline threshold (scripts/binaries/indices.py)', () => {
    const py = readFileSync(resolve(__dirname, '../binaries/indices.py'), 'utf8');
    const m = py.match(/^GAIA_BINDING_G_MINUS_V_REJECT_MAG\s*=\s*([\d.]+)/m);
    expect(m).not.toBeNull();
    expect(parseFloat(m![1])).toBe(GAIA_BINDING_G_MINUS_V_REJECT_MAG);
  });
});

describe('catalog-pure / sibling-letter attribution gate', () => {
  // Live SIMBAD shapes as of the 2026-07 re-pull: μ Dra carries
  // blend-suffixed HIPs (83608A + 83608B); HD 70492's bare HIP 41098
  // lives on a system-level SIMBAD object absent from the per-component
  // xids, so neither component row carries it.
  const XIDS_TSV = [
    'wds_id\tcomponent\tsimbad_oid\tsimbad_main_id\tgaia_source_id\thip',
    '17053+5428\tA\t373388\t* mu. Dra A\t1420101696287738368\t83608',
    '17053+5428\tB\t373389\t* mu. Dra B\t1420101696285626624\t83608',
    '17053+5428\tC\t373439\t* mu. Dra C\t1420101696286312448\t',
    '08231+2001\tA\t18621022\tHD  70492A\t663434291021197568\t',
    '08231+2001\tB\t18621023\tHD  70492B\t663434291018997248\t',
    '99990+9990\tA\t2\town-hip A\t556\t',
    '99990+9990\tB\t1\town-hip B\t555\t104217',
    '06451-1643\tA\t3\tsaturated A\t\t32349',
    '06451-1643\tB\t4\tsaturated B\t777\t',
    '11111+1111\tA\t5\tblend A\t888\t',
    '11111+1111\tB\t6\tblend B\t888\t',
    '22222+2222\tA\t7\tlineage A\t\t100',
    '22222+2222\tAa\t8\tlineage Aa\t999\t',
  ].join('\n');
  const xids = parseSimbadWdsXidsTsv(XIDS_TSV);

  it('parses source / HIP attributions and the primary source letter', () => {
    expect(xids.bySource.get('1420101696285626624')).toEqual([
      { wdsId: '17053+5428', component: 'B' },
    ]);
    expect(xids.byHip.get(83608)).toEqual([
      { wdsId: '17053+5428', component: 'A' },
      { wdsId: '17053+5428', component: 'B' },
    ]);
    expect(xids.primarySourceLetterByWds.get('17053+5428')).toBe('A');
    expect(xids.primarySourceLetterByWds.get('06451-1643')).toBe('B');
  });

  it('rejects required-column drift', () => {
    expect(() => parseSimbadWdsXidsTsv('wds_id\tcomponent\n')).toThrow(
      /missing required columns/,
    );
  });

  it('scrubs a blend-suffixed-HIP row keyed on the sibling source (μ Dra)', () => {
    expect(
      isSiblingLetterAttribution('1420101696285626624', 83608, xids),
    ).toBe(true);
  });

  it('scrubs a system-level-HIP row keyed on the sibling source (HD 70492)', () => {
    expect(
      isSiblingLetterAttribution('663434291018997248', 41098, xids),
    ).toBe(true);
  });

  it('keeps the primary letter source on the same rows', () => {
    expect(
      isSiblingLetterAttribution('1420101696287738368', 83608, xids),
    ).toBe(false);
    expect(
      isSiblingLetterAttribution('663434291021197568', 41098, xids),
    ).toBe(false);
  });

  it('keeps a secondary row whose own HIP is attributed to its letter', () => {
    expect(isSiblingLetterAttribution('555', 104217, xids)).toBe(false);
  });

  it('scrubs on directly-disjoint HIP letters even when the primary carries no source', () => {
    expect(isSiblingLetterAttribution('777', 32349, xids)).toBe(true);
  });

  it('never scrubs a photocentre blend (source attributed to two letters)', () => {
    expect(isSiblingLetterAttribution('888', 12345, xids)).toBe(false);
  });

  it('treats sub-letters as the parent lineage, not siblings', () => {
    expect(isSiblingLetterAttribution('999', 100, xids)).toBe(false);
  });

  it('is inert without a HIP or without the xids index', () => {
    expect(isSiblingLetterAttribution('1420101696285626624', null, xids)).toBe(false);
    expect(isSiblingLetterAttribution('1420101696285626624', 83608, null)).toBe(false);
  });

  it('resolveGaiaSourceId scrubs the native cell AND the cross-walk candidate', () => {
    const xmap = new Map<number, string>([[83608, '1420101696285626624']]);
    expect(
      resolveGaiaSourceId('1420101696285626624', 83608, xmap, null, null, xids),
    ).toEqual({
      gaiaSourceId: null, backfilled: false, magRejected: false,
      siblingRejected: true,
    });
    expect(
      resolveGaiaSourceId('663434291018997248', 41098, null, null, null, xids),
    ).toEqual({
      gaiaSourceId: null, backfilled: false, magRejected: false,
      siblingRejected: true,
    });
  });
});

describe('catalog-pure / spectralFromAbsmag', () => {
  it('inverts the MS calibration at the table anchors', () => {
    expect(spectralFromAbsmag(0.65)).toMatchObject({ classIdx: 2, lumClass: 2 });
    expect(spectralFromAbsmag(0.65).subclass).toBeCloseTo(0, 5);   // A0
    expect(spectralFromAbsmag(1.9).subclass).toBeCloseTo(5, 5);    // A5
    const g5 = spectralFromAbsmag(5.1);
    expect(g5.classIdx).toBe(4);
    expect(g5.subclass).toBeCloseTo(5, 5);                          // G5
  });

  it('lands Algol Ab (own M_V ~2.2) in the A range, not the inherited B8', () => {
    const info = spectralFromAbsmag(2.225);
    expect(info.classIdx).toBe(2);
    expect(info.subclass).toBeCloseTo(7, 0);
  });

  it('clamps outside the [O0, M9] span', () => {
    expect(spectralFromAbsmag(-9)).toMatchObject({ classIdx: 0, subclass: 0 });
    expect(spectralFromAbsmag(20)).toMatchObject({ classIdx: 6, subclass: 9 });
  });

  it('round-trips through absmagFromSpectral inside every class span', () => {
    for (const mv of [-5.0, -2.0, 1.0, 3.1, 4.9, 6.6, 12.0]) {
      const back = absmagFromSpectral(spectralFromAbsmag(mv));
      expect(back).not.toBeNull();
      expect(back!).toBeCloseTo(mv, 6);
    }
  });
});

describe('catalog-pure / angularSeparationDeg', () => {
  it('returns 0 for identical positions', () => {
    expect(angularSeparationDeg(5, -30, 5, -30)).toBeCloseTo(0, 10);
  });

  it('returns 90° between RA-axis pole and equator at RA=0', () => {
    expect(angularSeparationDeg(0, 90, 0, 0)).toBeCloseTo(90, 6);
  });

  it('returns ~90° for two equatorial points 6h apart', () => {
    expect(angularSeparationDeg(0, 0, 6, 0)).toBeCloseTo(90, 6);
  });

  it('matches a known LMC-direction great-circle distance', () => {
    // HD 268749 at (4.8915 h, -69.409°) → LMC centre (5.25067 h, -69.19°).
    // Compute by hand: small-angle approximation says ~2.5° separation;
    // exact vector form here is the canonical value.
    const sep = angularSeparationDeg(4.8915, -69.409, LMC_CENTRE_RA_HOURS, LMC_CENTRE_DEC_DEG);
    expect(sep).toBeGreaterThan(0.5);
    expect(sep).toBeLessThan(LMC_CONE_HALF_ANGLE_DEG);
  });
});

describe('catalog-pure / isInLmcCone', () => {
  it('accepts the LMC centre itself', () => {
    expect(isInLmcCone(LMC_CENTRE_RA_HOURS, LMC_CENTRE_DEC_DEG)).toBe(true);
  });

  it('rejects a solar-neighbourhood RA/Dec diametrically opposite the LMC', () => {
    // (RA=12h, Dec=0°) — far from the LMC cone.
    expect(isInLmcCone(12, 0)).toBe(false);
  });

  it('rejects the SMC direction (out of scope)', () => {
    // SMC centre ≈ (0.877 h, -72.8°). Outside the LMC cone — the SMC
    // override gets its own pipeline.
    expect(isInLmcCone(0.877, -72.8)).toBe(false);
  });

  it('boundary: just inside the cone passes, just outside fails', () => {
    // Confirms the cone gate is the half-angle, not something tighter
    // like a great-circle box.
    const epsilon = 0.01;
    const inDec = LMC_CENTRE_DEC_DEG + (LMC_CONE_HALF_ANGLE_DEG - epsilon);
    const outDec = LMC_CENTRE_DEC_DEG + (LMC_CONE_HALF_ANGLE_DEG + epsilon);
    expect(isInLmcCone(LMC_CENTRE_RA_HOURS, inDec)).toBe(true);
    expect(isInLmcCone(LMC_CENTRE_RA_HOURS, outDec)).toBe(false);
  });

  /** Great-circle destination from the LMC centre: walk `sepDeg` along
   *  initial position angle `paDeg` (east of north), return [raHours, decDeg].
   *  Standard navigation formulas — independent of angularSeparationDeg's
   *  vector implementation. */
  function offsetFromLmcCentre(sepDeg: number, paDeg: number): [number, number] {
    const d1 = (LMC_CENTRE_DEC_DEG * Math.PI) / 180;
    const s = (sepDeg * Math.PI) / 180;
    const pa = (paDeg * Math.PI) / 180;
    const d2 = Math.asin(Math.sin(d1) * Math.cos(s) + Math.cos(d1) * Math.sin(s) * Math.cos(pa));
    const dRa = Math.atan2(
      Math.sin(pa) * Math.sin(s) * Math.cos(d1),
      Math.cos(s) - Math.sin(d1) * Math.sin(d2),
    );
    return [
      LMC_CENTRE_RA_HOURS + (dRa * 180 / Math.PI) / 15,
      (d2 * 180) / Math.PI,
    ];
  }

  it('boundary: just inside the cone passes on the RA axis (cos(Dec) weighting)', () => {
    // At Dec −69.19° (cos Dec ≈ 0.355) a 15° great-circle arc due east
    // swings RA by 37.02°, not 15° — pin the stretch so a "simplified"
    // separation that drops the cos(Dec) weighting fails here.
    const epsilon = 0.01;
    const [raEdge] = offsetFromLmcCentre(LMC_CONE_HALF_ANGLE_DEG, 90);
    expect((raEdge - LMC_CENTRE_RA_HOURS) * 15).toBeCloseTo(37.0241, 3);
    const [raIn, decIn] = offsetFromLmcCentre(LMC_CONE_HALF_ANGLE_DEG - epsilon, 90);
    const [raOut, decOut] = offsetFromLmcCentre(LMC_CONE_HALF_ANGLE_DEG + epsilon, 90);
    expect(isInLmcCone(raIn, decIn)).toBe(true);
    expect(isInLmcCone(raOut, decOut)).toBe(false);
  });

  it('boundary: diagonal RA+Dec offset at cone edge', () => {
    // PA 45° — both axes move, so the gate must be great-circle
    // distance, not a per-axis (Manhattan/box) test.
    const epsilon = 0.01;
    const [raIn, decIn] = offsetFromLmcCentre(LMC_CONE_HALF_ANGLE_DEG - epsilon, 45);
    const [raOut, decOut] = offsetFromLmcCentre(LMC_CONE_HALF_ANGLE_DEG + epsilon, 45);
    expect(isInLmcCone(raIn, decIn)).toBe(true);
    expect(isInLmcCone(raOut, decOut)).toBe(false);
  });
});

describe('catalog-pure / LMC distance vs MAX_DIST_PC invariant', () => {
  it('LMC_DISTANCE_PC sits inside the bounded-scope cutoff', () => {
    // The kinematic override snaps ~54 supergiants to LMC_DISTANCE_PC,
    // then every row passes the dist > MAX_DIST_PC drop. If either
    // constant drifts across the other, the whole LMC population is
    // silently dropped with no counter to surface it. Any future
    // kinematic-override target (SMC ≈ 62 kpc) must either satisfy
    // this or raise MAX_DIST_PC.
    expect(LMC_DISTANCE_PC).toBeLessThan(MAX_DIST_PC);
  });
});

describe('catalog-pure / applyLmcKinematicOverride', () => {
  // Tier-A fixtures from AT-HYG / Gaia DR3 — three real LMC supergiants
  // (HDE 268xxx range) and one halo-PM outlier inside the LMC cone.
  // AT-HYG distances are the pre-override values that get smeared
  // 5-200 kpc by 1/π inversion.
  interface Fixture {
    label: string;
    ra: number; dec: number; mag: number;
    pmRa: number | null; pmDec: number | null;
    athygDist: number;
  }
  const LMC_HITS: Fixture[] = [
    { label: 'HD 268749 (B7 IAB LMC supergiant)', ra: 4.8915, dec: -69.409, mag: 12.029, pmRa: 2.044, pmDec: -0.096, athygDist: 13368.7 },
    { label: 'HD 268718',                         ra: 4.866, dec: -69.426, mag: 10.596, pmRa: 2.093, pmDec: -0.138, athygDist: 46323.4 },
    { label: 'HD 268654 (smeared to 196 kpc)',    ra: 4.820, dec: -69.457, mag: 10.5,   pmRa: 2.033, pmDec: -0.198, athygDist: 196078.4 },
  ];
  const LMC_PM_NON_HITS: Fixture[] = [
    // Inside the LMC cone but PM ≠ LMC bulk — a halo star or runaway,
    // should pass through unchanged.
    { label: 'HD 270752 (halo in LMC direction)', ra: 4.792, dec: -65.331, mag: 11.214, pmRa: 14.925, pmDec: -3.62, athygDist: 5298.5 },
  ];

  it('LMC-direction + LMC-PM star is snapped to 49.594 kpc', () => {
    for (const f of LMC_HITS) {
      const out = applyLmcKinematicOverride(f.ra, f.dec, f.mag, f.pmRa, f.pmDec);
      expect(out, f.label).not.toBeNull();
      expect(out!.dist, f.label).toBe(LMC_DISTANCE_PC);
      // Absolute magnitude recomputed at the new distance.
      expect(out!.absmag).toBeCloseTo(f.mag - 5 * Math.log10(LMC_DISTANCE_PC / 10), 10);
    }
  });

  it('LMC-direction + non-LMC-PM star is unchanged (null override)', () => {
    for (const f of LMC_PM_NON_HITS) {
      const out = applyLmcKinematicOverride(f.ra, f.dec, f.mag, f.pmRa, f.pmDec);
      expect(out, f.label).toBeNull();
    }
  });

  it('off-cone star with textbook LMC bulk PM is not overridden', () => {
    // The gate the function owns rather than delegates: a star whose PM
    // sits exactly on the LMC bulk centre but which lies nowhere near the
    // LMC gets no override. Snapping it would teleport a Galactic star to
    // 49.6 kpc.
    expect(applyLmcKinematicOverride(
      12, 0, 8, LMC_PM_RA_CENTRE, LMC_PM_DEC_CENTRE,
    )).toBeNull();
  });

  it('returns null when pm_ra or pm_dec is missing', () => {
    // A star in the LMC cone with null proper motion — should NOT be
    // overridden. AT-HYG carries blank pm_ra/pm_dec for pre-Hipparcos
    // entries; treat them as ineligible for the kinematic gate.
    expect(applyLmcKinematicOverride(
      LMC_CENTRE_RA_HOURS, LMC_CENTRE_DEC_DEG, 10, null, 0,
    )).toBeNull();
    expect(applyLmcKinematicOverride(
      LMC_CENTRE_RA_HOURS, LMC_CENTRE_DEC_DEG, 10, 0, null,
    )).toBeNull();
  });

  it('ordering: LMC_KIN wins over BJ for an LMC-cone star with both', () => {
    // Synthetic LMC-cone + LMC-PM star with a B-J entry. Simulates the
    // build-catalog.ts ordering: B-J runs first and writes its posterior;
    // LMC_KIN runs after and clobbers it. Test by composing the two
    // overrides in the same order as the build script.
    const f = LMC_HITS[0]; // HD 268749
    const sourceId = 'fake-lmc-source-id';
    const bjMap = new Map([[sourceId, 8000]]); // arbitrary B-J posterior ≠ LMC distance
    const bj = applyBailerJonesOverride(f.mag, sourceId, bjMap);
    expect(bj!.dist).toBe(8000);
    const lmc = applyLmcKinematicOverride(f.ra, f.dec, f.mag, f.pmRa, f.pmDec);
    expect(lmc!.dist).toBe(LMC_DISTANCE_PC);
    // Final state mirrors what build-catalog.ts ends up with.
    expect(lmc!.dist).not.toBe(bj!.dist);
  });

  it('boundary: PM tolerance is per-component, not radial', () => {
    // |Δpm_ra| at the tolerance, |Δpm_dec| at 0 → pass. Mirror case → pass.
    // Both at the tolerance → still pass (per-component, not Euclidean).
    const eps = 1e-9;
    const atCentre = [LMC_CENTRE_RA_HOURS, LMC_CENTRE_DEC_DEG, 10] as const;
    const passEdgeRa = applyLmcKinematicOverride(
      ...atCentre, LMC_PM_RA_CENTRE + LMC_PM_TOLERANCE - eps, LMC_PM_DEC_CENTRE,
    );
    expect(passEdgeRa).not.toBeNull();
    const passBothEdges = applyLmcKinematicOverride(
      ...atCentre,
      LMC_PM_RA_CENTRE + LMC_PM_TOLERANCE - eps,
      LMC_PM_DEC_CENTRE - LMC_PM_TOLERANCE + eps,
    );
    expect(passBothEdges).not.toBeNull();
    const failJustOver = applyLmcKinematicOverride(
      ...atCentre, LMC_PM_RA_CENTRE + LMC_PM_TOLERANCE + eps, LMC_PM_DEC_CENTRE,
    );
    expect(failJustOver).toBeNull();
  });

});

describe('catalog-pure / transport chunking', () => {
  it('planCatalogChunks splits on the target with a short final chunk', () => {
    expect(planCatalogChunks(350, 100)).toEqual([100, 100, 100, 50]);
    expect(planCatalogChunks(200, 100)).toEqual([100, 100]);
    expect(planCatalogChunks(50, 100)).toEqual([50]);
    expect(planCatalogChunks(0, 100)).toEqual([0]);
  });

  it('planCatalogChunks rejects a non-positive target', () => {
    expect(() => planCatalogChunks(100, 0)).toThrow(/Invalid chunk target/);
  });

  it('assembleCatalogChunks throws on chunk-count mismatch', () => {
    const manifest: CatalogManifest = { chunkBytes: [4, 4], totalBytes: 8 };
    expect(() => assembleCatalogChunks([new Uint8Array(4)], manifest)).toThrow(/count mismatch/);
  });

  it('assembleCatalogChunks throws on chunk-length mismatch', () => {
    const manifest: CatalogManifest = { chunkBytes: [4, 4], totalBytes: 8 };
    expect(() =>
      assembleCatalogChunks([new Uint8Array(4), new Uint8Array(3)], manifest),
    ).toThrow(/chunk 1 length mismatch/);
  });

  it('assembleCatalogChunks throws on total-bytes mismatch', () => {
    const manifest: CatalogManifest = { chunkBytes: [4], totalBytes: 8 };
    expect(() => assembleCatalogChunks([new Uint8Array(4)], manifest)).toThrow(/size mismatch/);
  });
});

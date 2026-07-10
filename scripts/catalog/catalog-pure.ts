// Pure, deterministic, side-effect-free transforms shared by
// build-catalog.ts and its tests — binary layout constants, spectral
// parsing, Stefan-Boltzmann radius, GCVS field extraction.

/** Solar-type B-V used as a fallback when no chromaticity input is
 *  available. ~0.65 yields a yellow disc rather than a hot blue or
 *  cold red default. Consumed by stars-parse's AT-HYG read (blank ci
 *  cells) and by star-color-routing-pure's tier-6 fallback. */
export const SOLAR_BV_FALLBACK = 0.65;

// ---- Spectral classification --------------------------------------------

export interface SpectralInfo {
  classIdx: number;     // 0-8 per spectClassIndex
  subclass: number;     // 0-9, defaults to 5 when missing
  lumClass: number;     // 0-9 (see encoding below), 255 if unknown
  isWhiteDwarf: boolean;
  wdSubclass: number;   // only valid if isWhiteDwarf (the digit after D)
  /** WN/WC Wolf-Rayet: shares classIdx 7 on the wire with carbon/S
   *  stars but routes tempKelvin/boloCorr through the WR tables — the
   *  carbon-star ~3 kK row misizes a ~40-140 kK WR photosphere by
   *  ~(T ratio)² ≈ 1000×. */
  isWolfRayet?: boolean;
}

/** Sentinel classIdx for "unparseable / unknown spectral class". Routes
 *  through T_TABLE[UNKNOWN_CLASS_IDX]'s neutral 5000 K row in tempKelvin
 *  / boloCorr, and tells the renderer's star-color routing to treat the
 *  spectral tier as missing and fall through to ballesteros / solar. */
export const UNKNOWN_CLASS_IDX = 8;

// Luminosity-class encoding shared with the renderer:
//   0 = VII / D  (white dwarf)        5 = II        (bright giant)
//   1 = VI / sd  (subdwarf)           6 = Ib        (less-luminous supergiant)
//   2 = V        (main sequence)      7 = Iab       (intermediate supergiant)
//   3 = IV       (subgiant)           8 = Ia        (luminous supergiant)
//   4 = III      (giant)              9 = Ia+ / 0   (hypergiant)
// 255 = unknown / unparseable
export function spectClassIndex(firstChar: string): number {
  switch (firstChar) {
    case 'O': return 0;
    case 'B': return 1;
    case 'A': return 2;
    case 'F': return 3;
    case 'G': return 4;
    case 'K': return 5;
    case 'M': return 6;
    case 'C': case 'S': case 'W': case 'N': case 'R': return 7;
    default: return UNKNOWN_CLASS_IDX;
  }
}

/** Canonical "no classification available" SpectralInfo. Consumed by
 *  callers that need a SpectralInfo even when SIMBAD + GSP-Spec both
 *  missed (the binary writer still needs to pack a spectClass/lumClass
 *  byte). lumClass=255 is the renderer's "no luminosity-class softness"
 *  sentinel. */
export const SPECTRAL_UNKNOWN: SpectralInfo = {
  classIdx: UNKNOWN_CLASS_IDX, subclass: 5, lumClass: 255, isWhiteDwarf: false, wdSubclass: 0,
};

// Roman luminosity-class lookup, longest prefix first so "III" never
// matches as "II" + "I".
const LUMINOSITY_PREFIXES: ReadonlyArray<readonly [RegExp, number]> = [
  [/^IA\+|^0(?!\d)/,  9],
  [/^IAB/,            7],
  [/^IA(?!B)/,        8],
  [/^IB/,             6],
  [/^III/,            4],
  [/^II(?!I)/,        5],
  [/^IV/,             3],
  [/^VII/,            0],
  [/^VI(?!I)/,        1],
  [/^V(?!I)/,         2],
  [/^I(?![IV])/,      7], // bare "I" — treat as Iab to centre the supergiant softness ramp
];

function lookupLumClass(window: string): number {
  // SIMBAD writes Roman luminosity-class suffixes mixed-case — uppercase
  // I/V plus lowercase a/b ("Ia", "Iab", "Ib"). Fold to uppercase once
  // here so each per-pattern regex stays case-sensitive (and won't
  // accidentally match elsewhere in the string).
  const upper = window.toUpperCase();
  for (const [re, lc] of LUMINOSITY_PREFIXES) {
    if (re.test(upper)) return lc;
  }
  return 255;
}

/** Strict Morgan-Keenan classifier for SIMBAD-canonical `sp_type`
 *  strings; returns null on unparseable input. See
 *  scripts/catalog/README.md § Physical radius and spectral parsing for
 *  handled shapes and the Am/Ap composite-tag preference order. */
export function classifyFromSimbad(rawSpType: string | null | undefined): SpectralInfo | null {
  if (!rawSpType) return null;
  const s = rawSpType.replace(/\s+/g, '');
  if (!s) return null;

  // Yerkes lowercase prefix: "d" = dwarf (lumClass V), "g" = giant (III).
  // SIMBAD keeps the convention on nearby M dwarfs / late-type giants
  // ("dM4.0", "gK0"). The prefix IS the luminosity declaration, so any
  // trailing Roman is overridden. Without this short-circuit the
  // first-char gate further down rejects the leading lowercase letter
  // and the row leaks to the GSP-Spec tier.
  const yerkesMatch = s.match(/^([dg])(?=[OBAFGKM])/);
  if (yerkesMatch) {
    const rest = s.slice(1);
    const classIdx = spectClassIndex(rest.charAt(0));
    const subMatch = rest.substring(1).match(/^(\d)(?:\.\d)?/);
    const subclass = subMatch ? Number(subMatch[1]) : 5;
    return {
      classIdx, subclass,
      lumClass: yerkesMatch[1] === 'g' ? 4 : 2,
      isWhiteDwarf: false, wdSubclass: 0,
    };
  }

  // White dwarfs: SIMBAD canonical form is D followed by one or more
  // subtype letters from {A, B, C, O, Q, X, Z, H, V} and an optional
  // digit. The strict letter set prevents the bug-table cases (DELTA
  // DEL / dK0 / DF) from falling into this branch — none of them
  // would survive SIMBAD's curation in the first place, and the
  // canonical form is uppercase so we don't need to fold case here.
  const wdMatch = s.match(/^D[ABCOHQXZV]+(\d(?:\.\d)?)?/);
  if (wdMatch) {
    const wdSub = wdMatch[1] ? Math.round(Number(wdMatch[1])) : 5;
    return {
      classIdx: UNKNOWN_CLASS_IDX, subclass: 5, lumClass: 0, isWhiteDwarf: true,
      wdSubclass: Math.max(0, Math.min(9, wdSub)),
    };
  }

  // Subdwarf prefix: "sdB", "sdO", etc. → lumClass=1 (subdwarf).
  const sdMatch = s.match(/^sd([OBAFGKM])(\d(?:\.\d)?)?/);
  if (sdMatch) {
    const cls = spectClassIndex(sdMatch[1]);
    const sub = sdMatch[2] ? Number(sdMatch[2].split('.')[0]) : 5;
    return { classIdx: cls, subclass: sub, lumClass: 1, isWhiteDwarf: false, wdSubclass: 0 };
  }

  // Composite Am/Ap tags: kA5hA8mF1(III)... — walk every [khm]<class><digit?>
  // group, retaining the latest per-tag, then pick m > h > k as the canonical
  // body and resume luminosity-class scanning from just after the composite
  // tail.
  const compositeRe = /([khm])([OBAFGKM])(\d(?:\.\d)?)?/g;
  let lastM = '', lastH = '', lastK = '';
  let compositeEnd = -1;
  let cm: RegExpExecArray | null;
  while ((cm = compositeRe.exec(s)) !== null) {
    const tagBody = cm[2] + (cm[3] ?? '');
    if (cm[1] === 'm') lastM = tagBody;
    else if (cm[1] === 'h') lastH = tagBody;
    else lastK = tagBody;
    compositeEnd = cm.index + cm[0].length;
  }

  let body: string;
  let lumWindow: string;
  if (lastM || lastH || lastK) {
    body = lastM || lastH || lastK;
    // After the composite tags, a parenthesised "(III)" or bare Roman
    // numeral can appear before the chemical-peculiarity tail.
    lumWindow = s.substring(compositeEnd).replace(/^\(+/, '');
  } else {
    body = s;
    lumWindow = '';
  }

  const firstChar = body.charAt(0);
  if (!/[OBAFGKMCSWNR]/.test(firstChar)) return null;
  const classIdx = spectClassIndex(firstChar);

  // Subclass digit: take the integer part of an optionally-fractional digit.
  let subclass = 5;
  let afterSub = 1;
  const subMatch = body.substring(1).match(/^(\d)(?:\.\d)?/);
  if (subMatch) {
    subclass = Number(subMatch[1]);
    afterSub += subMatch[0].length;
  }

  // Carbon / S / Wolf-Rayet bucket: classIdx=7, no luminosity-class slot.
  // SIMBAD writes carbon stars as "C5,2e" (subclass + abundance index) and
  // Wolf-Rayets as "WN5" / "WC4"; both lack a Roman luminosity class.
  if (classIdx === 7) {
    if (firstChar === 'W') {
      // WR+MK composites (γ² Vel "WC8+O7.5III-V"): the WR catalog
      // convention lists the WR first regardless of optical brightness,
      // but the MK companion dominates the V light the record's absmag
      // measures — classify by it (the Antares M+B convention already
      // classifies by the V-dominant first-listed component).
      const plus = body.indexOf('+');
      if (plus >= 0) {
        const companion = classifyFromSimbad(body.substring(plus + 1));
        if (
          companion && !companion.isWhiteDwarf
          && companion.classIdx !== 7
          && companion.classIdx !== UNKNOWN_CLASS_IDX
        ) {
          return companion;
        }
      }
      // The WR ionization subclass sits after the two-letter WN/WC/WO
      // prefix ("WN5", "WC4"), which the generic position-1 digit parse
      // above never reaches.
      const wrSub = body.match(/^W[NCO]?(\d)(?:\.\d)?/);
      return {
        classIdx,
        subclass: wrSub ? Number(wrSub[1]) : subclass,
        lumClass: 255,
        isWhiteDwarf: false, wdSubclass: 0, isWolfRayet: true,
      };
    }
    return { classIdx, subclass, lumClass: 255, isWhiteDwarf: false, wdSubclass: 0 };
  }

  if (!lumWindow) {
    lumWindow = body.substring(afterSub);
  }
  const lumClass = lookupLumClass(lumWindow);

  return { classIdx, subclass, lumClass, isWhiteDwarf: false, wdSubclass: 0 };
}

/** Map Gaia DR3 GSP-Spec's `spectraltype_esphs` enum to a SpectralInfo.
 *  The enum is letter-only (Recio-Blanco et al. 2023, A&A 674, A29);
 *  there's no subclass or luminosity class, so subclass defaults to 5
 *  (mid-range) and lumClass to 255 (unknown). Returns null for the
 *  catch-all "unknown" value and for unrecognised letters. */
export function classifyFromGspspec(esphs: string | null | undefined): SpectralInfo | null {
  if (!esphs) return null;
  const s = esphs.trim().toUpperCase();
  if (!s || s === 'UNKNOWN') return null;
  if (s === 'CSTAR') {
    return { classIdx: 7, subclass: 5, lumClass: 255, isWhiteDwarf: false, wdSubclass: 0 };
  }
  const firstChar = s.charAt(0);
  if (!/[OBAFGKM]/.test(firstChar)) return null;
  return {
    classIdx: spectClassIndex(firstChar), subclass: 5, lumClass: 255,
    isWhiteDwarf: false, wdSubclass: 0,
  };
}

function matchSimbadRow(
  row: SimbadSpectralRow | undefined,
): { info: SpectralInfo; source: 'simbad'; spectDisplay: string } | null {
  if (!row?.spType) return null;
  const info = classifyFromSimbad(row.spType);
  return info ? { info, source: 'simbad', spectDisplay: row.spType } : null;
}

/** Curated HIP → MK type for saturated stars whose SIMBAD entry is a
 *  component-lettered main_id ("* alf Gem A") carrying neither hip nor
 *  source_id, so both machine tiers miss and the record would fall to
 *  the 5000 K unknown class (inflating physicalRadius ~3×). Mirrors the
 *  binaries pipeline's component_sptype_overrides.tsv curated tier;
 *  literature citation per entry. */
export const CURATED_SPTYPE_BY_HIP: ReadonlyMap<number, string> = new Map([
  // Castor A (α Gem) — SIMBAD * alf Gem A sp_type=A1.5IV+ (Gray+ 2003).
  [36850, 'A1.5IV'],
]);

/** Five-tier spectral resolver — curated HIP override first, then
 *  SIMBAD `sp_type` by Gaia source_id, then SIMBAD `sp_type` by HIP,
 *  then Gaia DR3 GSP-Spec `spectraltype_esphs`, then SPECTRAL_UNKNOWN.
 *  The HIP tier rescues Gaia-saturated bright stars (Algol, Alsephina)
 *  whose SIMBAD row carries a valid MK type but no source_id, so the
 *  source_id key misses them and the radius chain would otherwise run
 *  the cool unknown-Teff fallback against a bright absmag and inflate
 *  ~4×; the curated tier covers the residue whose SIMBAD entry carries
 *  neither key (Castor).
 *  SIMBAD and GSP-Spec each separate Morgan-Keenan classification from
 *  variability-type annotation at the schema level (sp_type vs otype
 *  for SIMBAD; the dedicated enum column for GSP-Spec), so neither
 *  upstream needs the string-disambiguation defences that AT-HYG's
 *  conflated `spect` column required. */
export type SpectralSource = 'curated' | 'simbad' | 'gspspec' | 'fallback';
export function resolveSpectralInfo(
  gaiaSourceId: string | null,
  hip: number | null,
  simbad: SimbadSpectralIndex,
  apsisMap: Map<string, ApsisRow>,
): { info: SpectralInfo; source: SpectralSource; spectDisplay: string | null } {
  if (hip !== null && hip > 0) {
    const curated = CURATED_SPTYPE_BY_HIP.get(hip);
    const info = curated ? classifyFromSimbad(curated) : null;
    if (curated && info) {
      return { info, source: 'curated', spectDisplay: curated };
    }
  }
  const bySource = gaiaSourceId ? matchSimbadRow(simbad.bySource.get(gaiaSourceId)) : null;
  if (bySource) return bySource;
  const byHip = hip !== null && hip > 0 ? matchSimbadRow(simbad.byHip.get(hip)) : null;
  if (byHip) return byHip;
  if (gaiaSourceId) {
    const apsis = apsisMap.get(gaiaSourceId);
    if (apsis?.spectraltypeEsphs) {
      const info = classifyFromGspspec(apsis.spectraltypeEsphs);
      if (info) return { info, source: 'gspspec', spectDisplay: apsis.spectraltypeEsphs };
    }
  }
  return { info: SPECTRAL_UNKNOWN, source: 'fallback', spectDisplay: null };
}

/** Hover/search display string: prefer the resolver's MK-canonical
 *  output, fall back to a cleaned-up AT-HYG raw cell (trailing `*+`
 *  stripped, internal whitespace collapsed). Returns null when both
 *  are blank. */
export function resolveSpectDisplay(
  resolved: string | null, rawSpect: string,
): string | null {
  if (resolved) return resolved;
  const t = rawSpect.trim();
  if (!t) return null;
  return t.replace(/\*+$/, '').trim().replace(/\s+/g, ' ');
}

// ---- Stefan-Boltzmann physical-radius chain -----------------------------

// Effective temperature (Kelvin) by spectral class + subclass for main-sequence
// stars. Giants and supergiants of the same letter+digit run ~10-15% cooler;
// the physical-radius calculation rides mostly on the *relative* scaling, so
// the MS table is close enough. White dwarfs use a separate formula.
const T_TABLE: Record<number, [number, number][]> = {
  0: [[0, 50000], [5, 42000], [9, 34000]],             // O
  1: [[0, 30000], [5, 15200], [9, 10500]],             // B
  2: [[0,  9790], [5,  8180], [9,  7600]],             // A
  3: [[0,  7300], [5,  6650], [9,  6050]],             // F
  4: [[0,  5940], [5,  5560], [9,  5310]],             // G
  5: [[0,  5150], [5,  4410], [9,  3900]],             // K
  6: [[0,  3840], [5,  3170], [9,  2500]],             // M
  7: [[0,  4000], [5,  3000], [9,  2500]],             // C/S/N/R (cool carbon) — rough; WR routes via WR_T_TABLE
  8: [[0,  5000], [5,  5000], [9,  5000]],             // unknown — neutral default
};

function interpolate(table: [number, number][], key: number): number {
  // Explicit high-end clamp: callers contract for keys in [0, 9] and the
  // tables span [0, 9] inclusive, so any key >= the last bucket boundary
  // is at-or-beyond the table. Returning the last value here is the
  // documented out-of-range behaviour and lets the loop body assume
  // key < k1 on every iteration.
  const last = table[table.length - 1];
  if (key >= last[0]) return last[1];
  for (let i = 1; i < table.length; i++) {
    const [k0, v0] = table[i - 1];
    const [k1, v1] = table[i];
    if (key <= k1) {
      const t = (key - k0) / (k1 - k0);
      return v0 + (v1 - v0) * t;
    }
  }
  return last[1];
}

// Wolf-Rayet Teff / BC by ionization subclass — one shared WN/WC ramp
// (WN2 ~141 kK … WN8 ~45 kK, Hamann+ 2006; WC4 ~117 kK … WC9 ~44 kK,
// Sander+ 2012), within the sizing scatter for display radii.
const WR_T_TABLE: [number, number][] = [[0, 140000], [5, 75000], [9, 44000]];
const WR_BC_TABLE: [number, number][] = [[0, -6.0], [5, -4.0], [9, -2.7]];

export function tempKelvin(info: SpectralInfo): number {
  if (info.isWhiteDwarf) {
    // WD spectral number is T_eff / 50400 × 10 (inverted from Sion et al.);
    // so T_eff ≈ 50400 / N for N=1..9.
    const n = Math.max(1, info.wdSubclass);
    return 50400 / n;
  }
  if (info.isWolfRayet) {
    return interpolate(WR_T_TABLE, info.subclass);
  }
  return interpolate(T_TABLE[info.classIdx] ?? T_TABLE[UNKNOWN_CLASS_IDX], info.subclass);
}

// Bolometric correction by spectral class + subclass. Mostly negligible for
// solar-type stars; large negatives for O/B (lots of UV) and M (lots of IR).
const BC_TABLE: Record<number, [number, number][]> = {
  0: [[0, -4.9], [5, -4.4], [9, -3.3]],
  1: [[0, -3.16], [5, -1.46], [9, -0.51]],
  2: [[0, -0.30], [5, -0.15], [9, -0.10]],
  3: [[0, -0.09], [5, -0.14], [9, -0.16]],
  4: [[0, -0.18], [5, -0.21], [9, -0.31]],
  5: [[0, -0.31], [5, -0.72], [9, -1.20]],
  6: [[0, -1.38], [5, -2.73], [9, -4.10]],
  7: [[0, -2.00], [5, -3.00], [9, -4.00]],
  8: [[0,  0.00], [5,  0.00], [9,  0.00]],
};

export function boloCorr(info: SpectralInfo): number {
  if (info.isWhiteDwarf) {
    // WDs have large BCs that depend strongly on T; a single value is a lie
    // but good enough for display sizing. Hot DA ≈ -2, cool ≈ 0.
    const T = tempKelvin(info);
    if (T > 30000) return -2.5;
    if (T > 15000) return -1.0;
    if (T > 8000) return -0.2;
    return 0.3;
  }
  if (info.isWolfRayet) {
    return interpolate(WR_BC_TABLE, info.subclass);
  }
  return interpolate(BC_TABLE[info.classIdx] ?? BC_TABLE[UNKNOWN_CLASS_IDX], info.subclass);
}

const T_SUN = 5778;
const MBOL_SUN = 4.74;

// Sanity window for a measured Apsis Teff feeding the radius chain —
// values outside it are pipeline artifacts (gspphot non-convergence),
// not stars, and fall through to the class table.
export const APSIS_TEFF_MIN_K = 2000;
export const APSIS_TEFF_MAX_K = 60000;

/** Pick the measured Gaia DR3 Apsis Teff for the radius chain:
 *  gspphot first, gspspec fallback (the same preference the runtime
 *  colour routing uses), gated to the physical sanity window. Returns
 *  null when neither solution carries a usable value. */
export function resolveApsisTeff(apsis: ApsisRow | null | undefined): number | null {
  if (!apsis) return null;
  for (const t of [apsis.teffGspphot, apsis.teffGspspec]) {
    if (t !== null && t > APSIS_TEFF_MIN_K && t < APSIS_TEFF_MAX_K) return t;
  }
  return null;
}

// Compute physical radius in solar radii from absolute magnitude + spectral
// info via Stefan-Boltzmann. Clamped to sane bounds so odd catalog entries
// don't produce absurd values. `teffOverride` (a measured Apsis Teff via
// resolveApsisTeff) replaces the class-table Teff when present; BC stays
// class-table (class-table BC against a measured T still beats class-table
// both). White dwarfs and Wolf-Rayets keep their dedicated treatments —
// gspphot doesn't model either atmosphere, so a published value there is
// the companion's or a misfit.
export function physicalRadius(
  absmag: number, info: SpectralInfo, teffOverride: number | null = null,
): number {
  if (info.isWhiteDwarf) {
    // White dwarfs cluster tightly around 0.01 R☉; absmag doesn't translate
    // reliably into a radius for them.
    return 0.013;
  }
  const T = teffOverride !== null && !info.isWolfRayet
    ? teffOverride
    : tempKelvin(info);
  const BC = boloCorr(info);
  const Mbol = absmag + BC;
  const L = Math.pow(10, (MBOL_SUN - Mbol) / 2.5); // L/L☉
  if (!Number.isFinite(L) || L <= 0) return 1.0;
  const R = Math.sqrt(L) * (T_SUN / T) * (T_SUN / T);
  // Empirical stellar range: red dwarfs bottom around 0.08 R☉, extreme
  // supergiants top around ~2000 R☉. Beyond these is bad catalog data.
  return Math.max(0.08, Math.min(2500, R));
}

// Absolute visual magnitude M_V by spectral class + subclass, calibrated
// per luminosity class (Cox 2000 §15.3, Pecaut & Mamajek 2013 — the same
// tables mass_estimate.py reads for the mass-ratio backfill).
const MV_MS_TABLE: Record<number, [number, number][]> = {
  0: [[0, -5.8], [5, -5.5], [9, -4.3]],   // O V
  1: [[0, -4.0], [5, -1.2], [9,  0.4]],   // B V
  2: [[0,  0.65], [5,  1.9], [9,  2.55]], // A V
  3: [[0,  2.7], [5,  3.5], [9,  4.3]],   // F V
  4: [[0,  4.4], [5,  5.1], [9,  5.8]],   // G V
  5: [[0,  5.9], [5,  7.4], [9,  8.6]],   // K V
  6: [[0,  8.8], [5, 12.3], [9, 16.0]],   // M V
};

const MV_GIANT_TABLE: Record<number, [number, number][]> = {
  0: [[0, -6.3], [5, -5.9], [9, -5.2]],   // O III
  1: [[0, -5.0], [5, -2.2], [9, -0.5]],   // B III
  2: [[0, -0.3], [5,  0.6], [9,  1.0]],   // A III
  3: [[0,  1.1], [5,  1.4], [9,  1.2]],   // F III
  4: [[0,  1.0], [5,  0.9], [9,  0.8]],   // G III
  5: [[0,  0.7], [5, -0.2], [9, -0.4]],   // K III
  6: [[0, -0.4], [5, -0.8], [9, -1.0]],   // M III
};

// Supergiant M_V is roughly spectral-class-independent in V; one
// constant per luminosity class is within the calibration scatter.
const MV_BY_SUPERGIANT_LUMCLASS: Record<number, number> = {
  5: -2.3,   // II
  6: -4.5,   // Ib
  7: -6.0,   // Iab
  8: -7.5,   // Ia
  9: -8.8,   // Ia+/0
};

const MV_SUBDWARF_OFFSET = 1.5;

/** Absolute visual magnitude from a parsed MK type. Companion promotion
 *  uses this when a promoted secondary's photometry is inherited from
 *  the system primary and no WDS Δmag exists to impute from — the
 *  per-component spectral type is then the only honest brightness
 *  signal. Returns null for white dwarfs, carbon/WR stars, and the
 *  unknown class, where a single M_V calibration would be fiction. */
export function absmagFromSpectral(info: SpectralInfo): number | null {
  if (info.isWhiteDwarf || info.classIdx === 7 || info.classIdx === UNKNOWN_CLASS_IDX) {
    return null;
  }
  const ms = MV_MS_TABLE[info.classIdx];
  const giant = MV_GIANT_TABLE[info.classIdx];
  if (!ms || !giant) return null;
  const mvMs = interpolate(ms, info.subclass);
  switch (info.lumClass) {
    case 0: return null;                                     // VII/D without WD flag
    case 1: return mvMs + MV_SUBDWARF_OFFSET;                // VI/sd
    case 3: return (mvMs + interpolate(giant, info.subclass)) / 2;  // IV
    case 4: return interpolate(giant, info.subclass);        // III
    case 5: case 6: case 7: case 8: case 9:
      return MV_BY_SUPERGIANT_LUMCLASS[info.lumClass];
    default: return mvMs;                                    // V or unknown → MS
  }
}

/** Piecewise-linear inverse of an anchor table: value → key. Assumes the
 *  table's values are monotonically increasing (MV_MS_TABLE is, O0 → M9);
 *  clamps to the end keys outside the span. */
function inverseInterpolate(table: [number, number][], value: number): number {
  if (value <= table[0][1]) return table[0][0];
  for (let i = 1; i < table.length; i++) {
    const [k0, v0] = table[i - 1];
    const [k1, v1] = table[i];
    if (value <= v1) return k0 + ((k1 - k0) * (value - v0)) / (v1 - v0);
  }
  return table[table.length - 1][0];
}

/** Main-sequence (classIdx, subclass) from an absolute visual magnitude —
 *  the inverse of `absmagFromSpectral`'s MS branch. The input M_V must be
 *  intrinsic (de-extincted): the MV_MS_TABLE calibration is. Clamped to
 *  the table's [O0, M9] span; lumClass is always V (2). Wrong for evolved
 *  companions, but strictly less wrong than the alternative it replaces
 *  (wearing the system primary's type) — curated overrides and measured
 *  per-component types take precedence upstream. */
export function spectralFromAbsmag(mv: number): SpectralInfo {
  let cls = 6;
  for (let c = 0; c < 6; c++) {
    const [, mvEnd] = MV_MS_TABLE[c][MV_MS_TABLE[c].length - 1];
    if (mv <= mvEnd) {
      cls = c;
      break;
    }
  }
  return {
    classIdx: cls,
    subclass: inverseInterpolate(MV_MS_TABLE[cls], mv),
    lumClass: 2,
    isWhiteDwarf: false,
    wdSubclass: 0,
  };
}

// ---- GCVS variable-star catalogue parsing -------------------------------

// GCVS designations in both files are space-padded fixed-width, e.g.
// "R     And *" or "Z     Peg". Trailing asterisk is an indicator we
// don't need; collapse internal whitespace to a single space.
export function normalizeGcvsName(raw: string): string {
  return raw
    .replace(/\*+$/, '')
    .trim()
    .replace(/\s+/g, ' ');
}

// Parse a possibly-annotated GCVS number field: entries may carry "<", ">",
// ":", "()" uncertainty markers or trailing "*"; strip them before parsing.
export function parseGcvsNumber(s: string): number | null {
  const t = s.trim().replace(/[<>():;*]/g, '').trim();
  if (!t) return null;
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : null;
}

// Per-star variability-type enum. Stored at RECORD_LAYOUT.varType (uint8
// at byte 37); shaders + runtime gate pulsation off this. Tagged with
// 0 = unknown so a build that predates the varType column reads as
// "non-variable" by default without a magic-version bump.
//
// Eclipsing = 2 is the load-bearing value — paired with binaries.bin's
// has_orbit flag, the runtime suppresses GCVS-amplitude pulsation for
// EA/EB/EW stars whose photometric signal now comes from the geometric-
// occlusion field instead.
export const VAR_TYPE_UNKNOWN = 0;
export const VAR_TYPE_PULSATING = 1;
export const VAR_TYPE_ECLIPSING = 2;
export const VAR_TYPE_OTHER = 3;

/** Amplitude byte: 0.05 mag quanta, saturating at 12.75 mag. */
export function encodeAmpUnits(amplitudeMag: number): number {
  return Math.min(255, Math.max(0, Math.round(amplitudeMag * 20)));
}

/** Period uint16: 0.1 d quanta, saturating at 6553.5 d. */
export function encodePeriodUnits(periodDays: number): number {
  return Math.min(65535, Math.max(0, Math.round(periodDays * 10)));
}

/** Classify a GCVS variability-type column ("EA", "EA/RS", "M", "DCEP",
 *  "RRAB", "SR", "ZAND", "UGSU", ...) into the runtime enum.
 *
 *  Composite types ("EA+RS", "EA/RS", "EA/DM") are classified as
 *  eclipsing whenever the eclipsing-binary prefix appears anywhere in
 *  the string — the geometric-occlusion signal is the real photometric
 *  driver, and superimposing a synthetic intrinsic pulsation on top
 *  would double-count the eclipse depth. */
export function classifyGcvsVarType(rawType: string | null | undefined): number {
  if (!rawType) return VAR_TYPE_UNKNOWN;
  const t = rawType.trim().toUpperCase();
  if (!t) return VAR_TYPE_UNKNOWN;
  // Eclipsing-binary prefixes anywhere in the string. EA / EB / EW are
  // GCVS's three canonical eclipsing classes; ELL is ellipsoidal (no
  // primary minimum, but the modulation is geometric, same suppression
  // logic applies). E* catches the bare "E" form GCVS uses on
  // unclassified eclipsing systems. EP (eclipsing-by-planet) is
  // deliberately NOT here — a transiting-planet host is not a stellar
  // multiple, so it must earn no wings and fall through to VAR_TYPE_OTHER.
  if (/\bE([ABW]|LL)?\b/.test(t)) return VAR_TYPE_ECLIPSING;
  // Intrinsic pulsators, identified by a family prefix at the start of a
  // GCVS type component (split on the composite separators + / |). Only
  // the base family is listed; GCVS's trailing subtype letters
  // ("DCEP"→"DCEPS", "CW"→"CWA/CWB", "RV"→"RVA/RVB", "L"→"LB/LC") are
  // accepted by the tail gate below, so the list never has to enumerate
  // every subtype. Order matters: the longer of two nested families
  // comes first so it wins the `startsWith` ("DCEP"/"BCEP" before "CEP").
  // "M" and "L" are LAST — a bare single letter would otherwise shadow a
  // longer family sharing that initial.
  const pulsatorPrefixes = [
    'DCEP', 'BCEP', 'CEP',
    'DSCT', 'GDOR', 'SXPHE', 'PVTEL', 'ACYG', 'ROAP',
    'WVIR', 'CW',
    'RR', 'RV',
    'SPB',
    'SR',
    'ZZ',
    'M', 'L',
  ];
  for (const part of t.split(/[+/|]/)) {
    const p = part.trim();
    if (!p) continue;
    for (const pre of pulsatorPrefixes) {
      if (p.startsWith(pre)) {
        // The tail after the family prefix must be a GCVS subtype
        // continuation: trailing subtype letters, a digit, a paren, or
        // end-of-string. No non-pulsator GCVS code shares a pulsator
        // family's prefix, so a letter tail is always a subtype — never
        // a coincidental longer word. A non-matching tail falls through
        // to the next prefix.
        const tail = p.slice(pre.length);
        if (tail === '' || /^[A-Z0-9()/.]/.test(tail)) return VAR_TYPE_PULSATING;
      }
    }
  }
  // Anything GCVS classifies that isn't eclipsing or a pulsator —
  // cataclysmic (UG*, ZAND), eruptive (FU, GCAS, IN*), rotating
  // (ACV, BY, RS, ELL, FKCOM), X-ray binaries (X*) — falls through
  // here. The shader's pulsation gate doesn't fire on these (varType
  // != ECLIPSING), so they keep their GCVS-amplitude modulation as
  // before. The category exists primarily for hover-tooltip
  // disambiguation and future per-type rendering.
  return VAR_TYPE_OTHER;
}

/** True when GCVS "EP" (eclipsing-by-planet) is the star's SOLE
 *  variability class. A transiting-planet host has no intrinsic
 *  variability (the dip is extrinsic occlusion by a planet) and is not
 *  a stellar multiple, so it earns neither a variable ring/pulse nor
 *  multi-star wings — the cross-match drops it entirely. A superimposed
 *  intrinsic pulsator ("EP+DSCT") classifies as that pulsator and keeps
 *  its ring, so it returns false here. */
export function isPlanetaryTransitOnly(rawType: string | null | undefined): boolean {
  if (!rawType) return false;
  if (!/\bEP\b/.test(rawType.trim().toUpperCase())) return false;
  return classifyGcvsVarType(rawType) === VAR_TYPE_OTHER;
}

// ---- Binary catalog format ----------------------------------------------

// Single source of truth for the catalog.bin file layout, shared by the
// writer (scripts/catalog/build-catalog), the runtime reader
// (src/client/loaders/catalog-loader), and the verify tool
// (scripts/catalog/verify-catalog).
//
// File structure:
//   [0,                       HEADER_SIZE)                              header
//   [HEADER_SIZE,             HEADER_SIZE + count*RECORD_SIZE)          records
//   [HEADER_SIZE + count*RECORD_SIZE,                       end)        name table
//
// HEADER_LAYOUT / RECORD_LAYOUT below carry the per-field byte offsets;
// HEADER_FIELD_SIZES / RECORD_FIELD_SIZES carry the matching byte widths
// and field kinds. Adding/changing a field means: bump BINARY_VERSION +
// MAGIC, extend the LAYOUT + SIZES pair with the new offset and kind, and
// the writer + reader + tests pick the change up automatically.

export const MAGIC = 'HYG7';
export const BINARY_VERSION = 7;
export const HEADER_SIZE = 32;
export const RECORD_SIZE = 84;
export const NO_COMPANION = 0xffffffff;
// Reserved none/invalid SID sentinel (docs/sid.md § 2); allocation starts
// at 1, so 0 in RECORD_LAYOUT.sid means the record resolved to no ledger
// row — a state build-catalog.ts writes only in its unallocated-bootstrap
// path before hard-failing (scripts/catalog/README.md § SID allocation).
export const NO_SID = 0;
// Sentinel uint8 stored at RECORD_LAYOUT.conIndex when the star has no
// constellation assignment. Valid IAU constellation indexes are
// 0..87 (88 modern constellations); 255 is unambiguous.
export const NO_CONSTELLATION_INDEX = 0xff;
// Sentinel uint64 stored at RECORD_LAYOUT.gaiaSourceId when AT-HYG's
// `gaia` column is blank. Valid Gaia DR3 source_ids are positive 63-bit
// integers, so 0 is unambiguous.
export const NO_GAIA_SOURCE_ID = 0n;
// Float32 NaN is the null sentinel for the seven Gaia DR3 Apsis fields
// (teff/logg/[M/H]/A0 from gspphot ∪ gspspec). NaN survives IEEE-754
// round-trip through DataView.setFloat32/getFloat32 and never collides
// with a physical value — Teff > 0, logg > 0, A0 ≥ 0, [M/H] is finite.
// Consumers test with `Number.isNaN(x)`.
export const NO_APSIS = NaN;

// On-disk transport chunking — the single reassembly contract shared by the
// writer, client loader, and Node reader. See scripts/catalog/README.md
// § On-disk transport chunking.

export const CATALOG_MANIFEST_FILENAME = 'catalog-manifest.json';

// 16 MiB keeps every chunk clear of the 25 MiB Workers ceiling with growth
// headroom — do not raise toward 25 or a fuller catalog breaks deploy.
export const CATALOG_CHUNK_TARGET_BYTES = 16 * 1024 * 1024;

export interface CatalogManifest {
  /** Byte length of each chunk in `catalog.bin.<i>` order. */
  chunkBytes: number[];
  /** Sum of chunkBytes — assembled length, for pre-alloc + integrity check. */
  totalBytes: number;
}

export function catalogChunkFilename(index: number): string {
  return `catalog.bin.${index}`;
}

/** Split a total byte length into sequential per-chunk lengths, each
 *  ≤ targetBytes. A zero-length buffer yields one empty chunk so the
 *  manifest always carries ≥1 entry. */
export function planCatalogChunks(
  totalBytes: number,
  targetBytes: number = CATALOG_CHUNK_TARGET_BYTES,
): number[] {
  if (targetBytes <= 0) throw new Error(`Invalid chunk target: ${targetBytes}`);
  if (totalBytes <= 0) return [0];
  const chunkBytes: number[] = [];
  for (let off = 0; off < totalBytes; off += targetBytes) {
    chunkBytes.push(Math.min(targetBytes, totalBytes - off));
  }
  return chunkBytes;
}

/** Concatenate transport chunks back into the assembled buffer, validating
 *  each length and the running total against the manifest. */
export function assembleCatalogChunks(
  chunks: Uint8Array[],
  manifest: CatalogManifest,
): ArrayBuffer {
  if (chunks.length !== manifest.chunkBytes.length) {
    throw new Error(
      `Catalog chunk count mismatch: got ${chunks.length}, manifest expects ${manifest.chunkBytes.length}`,
    );
  }
  const out = new Uint8Array(manifest.totalBytes);
  let off = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i].byteLength !== manifest.chunkBytes[i]) {
      throw new Error(
        `Catalog chunk ${i} length mismatch: got ${chunks[i].byteLength}, manifest expects ${manifest.chunkBytes[i]}`,
      );
    }
    out.set(chunks[i], off);
    off += chunks[i].byteLength;
  }
  if (off !== manifest.totalBytes) {
    throw new Error(
      `Catalog assembly size mismatch: assembled ${off}, manifest total ${manifest.totalBytes}`,
    );
  }
  return out.buffer;
}

export const HEADER_LAYOUT = {
  magic: 0,            // 4 bytes ASCII
  version: 4,          // uint32
  count: 8,            // uint32
  nameTableOffset: 12, // uint32
  nameTableLength: 16, // uint32
  // bytes 20..31 reserved
} as const;

/** Per-field byte width keyed by HEADER_LAYOUT name. Single source of
 *  truth shared with the layout regression tests so size assertions
 *  can't drift from the actual encoding. */
export const HEADER_FIELD_SIZES: Record<keyof typeof HEADER_LAYOUT, number> = {
  magic: 4,
  version: 4,
  count: 4,
  nameTableOffset: 4,
  nameTableLength: 4,
};

export const RECORD_LAYOUT = {
  x: 0,           // float32
  y: 4,           // float32
  z: 8,           // float32
  absmag: 12,     // float32
  ci: 16,         // float32
  physRadius: 20, // float32
  companion: 24,  // uint32 (NO_COMPANION = none)
  nameOffset: 28, // uint32 (0 = unnamed)
  spectClass: 32, // uint8
  lumClass: 33,   // uint8
  conIndex: 34,   // uint8 (NO_CONSTELLATION_INDEX = none)
  flags: 35,      // uint8 (FLAG_*)
  ampUnits: 36,   // uint8 (×0.05 mag)
  varType: 37,    // uint8 (VAR_TYPE_*; 0 = unknown / non-variable)
  period: 38,     // uint16 (×0.1 days)
  hip: 40,        // uint32 (0 = no HIP)
  gaiaSourceId: 44, // uint64 LE (0 = no Gaia DR3 source_id)
  // Gaia DR3 Apsis (gspphot ∪ gspspec). NO_APSIS (NaN) for the ~15% gap.
  teffGspphot: 52,  // float32 (K)
  loggGspphot: 56,  // float32 (log cgs)
  mhGspphot: 60,    // float32 ([M/H] dex)
  azeroGspphot: 64, // float32 (mag, line-of-sight extinction)
  teffGspspec: 68,  // float32 (K)
  loggGspspec: 72,  // float32 (log cgs)
  mhGspspec: 76,    // float32 ([M/H] dex)
  sid: 80,          // uint32 Stellata ID (0 = NO_SID; docs/sid.md § 7)
} as const;

/** Per-field byte width keyed by RECORD_LAYOUT name. As with
 *  HEADER_FIELD_SIZES the test suite derives non-overlap + bound checks
 *  from this map so any new field gets coverage by extending one place. */
export const RECORD_FIELD_SIZES: Record<keyof typeof RECORD_LAYOUT, number> = {
  x: 4, y: 4, z: 4, absmag: 4, ci: 4, physRadius: 4,
  companion: 4, nameOffset: 4,
  spectClass: 1, lumClass: 1, conIndex: 1, flags: 1, ampUnits: 1,
  varType: 1, period: 2, hip: 4, gaiaSourceId: 8,
  teffGspphot: 4, loggGspphot: 4, mhGspphot: 4, azeroGspphot: 4,
  teffGspspec: 4, loggGspspec: 4, mhGspspec: 4, sid: 4,
};

// Name table layout: two zero bytes of padding so name offset 0 reads as
// the "no name" sentinel, followed by length-prefixed UTF-8 strings:
// uint16 byteLen, then byteLen bytes.
export const NAME_TABLE_PADDING = 2;
export const NAME_LENGTH_PREFIX_BYTES = 2;

// ---- search-index.json wire contract ------------------------------------

// One entry per searchable star written by build-catalog.ts and consumed
// by src/client/search.ts. Keys are short (i/p/b/f/c/s/g/hip/hd/hr/gl/cl/cp)
// for wire size — the index is ~15 MB raw with hundreds of thousands of
// entries. Sharing the interface across writer + reader is the contract:
// drift here ships a broken index.
export interface SearchEntry {
  i: number;     // record index in the binary catalog
  p?: string;    // proper name (Sol, Sirius, …)
  b?: string;    // Bayer designation as in AT-HYG (Alp, Alp-1, …)
  f?: number;    // Flamsteed number
  c?: number;    // constellation index (255 = none, omitted)
  s?: string;    // spectral designation, cleaned for display
  g?: string;    // GCVS variable-star designation (R CrB, VY CMa, V0645 Cen)
  hip?: number;  // Hipparcos catalogue number
  hd?: number;   // Henry Draper number
  hr?: number;   // Harvard Revised / Yale BSC number
  gl?: string;   // Gliese / GJ designation
  cl?: string;   // multiple-star component letter (A/B/C/Ab…) — see search.ts
  cp?: number;   // system primary's record index; base for "<designation> <cl>"
}

// ---- Catalog flag bits --------------------------------------------------

// Per-star bitfield stored at RECORD_LAYOUT.flags. Single source of truth
// for both writers (scripts/catalog/build-catalog, scripts/catalog/catalog-pure
// inferBinaries) and readers (catalog-loader, chart-labels,
// verify-catalog). Adding a bit means adding a name to the FLAGS
// registry, not sprinkling another magic number — the regression tests
// then automatically pin distinct-ness and single-bit-ness.
//
// FLAGS is the canonical registry; the FLAG_* exports below are named
// aliases for callsite readability.
export const FLAGS = {
  hasName: 0x01,
  isSol: 0x02,
  hasBayer: 0x04,
  binaryCompanionOnly: 0x08,
  binaryPrimary: 0x10,
  /** Companion addressable only via the row-index map's `bySynth`
   *  table. See scripts/catalog/README.md § Companion promotion. */
  binaryCompanionSynthetic: 0x20,
} as const;
export const FLAG_HAS_NAME = FLAGS.hasName;
export const FLAG_IS_SOL = FLAGS.isSol;
export const FLAG_HAS_BAYER = FLAGS.hasBayer;
export const FLAG_BINARY_COMPANION_ONLY = FLAGS.binaryCompanionOnly;
export const FLAG_BINARY_PRIMARY = FLAGS.binaryPrimary;
export const FLAG_BINARY_COMPANION_SYNTHETIC = FLAGS.binaryCompanionSynthetic;

/** Bits intentionally left free for future use — adding functionality
 *  that fits inside one of these does not require a BINARY_VERSION bump.
 *  The reservation is pinned by a regression test: drifting RESERVED into
 *  any FLAGS value forces a deliberate edit here. */
export const RESERVED_FLAG_BITS = 0x40 | 0x80;

// ---- Geometric binary inference -----------------------------------------

// Pairs within this 3D distance are flagged as a physical binary/multiple
// system. 0.005 pc ≈ 1030 AU — wide-binary territory. Gaia resolves most
// bound pairs wider than ~0.5 arcsec so this captures the visually-
// renderable cases.
export const BINARY_MAX_SEP_PC = 0.005;

// Structural type of a star record consumed by `inferBinaries`. The build
// script's full Star type extends this; the helper only reads/writes the
// fields named here.
export interface BinaryStar {
  x: number;
  y: number;
  z: number;
  absmag: number;
  flags: number;
  companionIdx: number;
}

// Index of the brightest (lowest absmag) star in `indices`, or -1 when
// empty. Single point of truth for the "primary = brightest of group"
// convention shared by every binary-flagging path (geometric mutual pairs
// in inferBinaries; CCDM groups + curated doubles in applyDoublesFlag).
export function pickBrightest(
  stars: Pick<BinaryStar, 'absmag'>[],
  indices: number[],
): number {
  let bestIdx = -1;
  let bestMag = Infinity;
  for (const i of indices) {
    const m = stars[i].absmag;
    if (m < bestMag) {
      bestMag = m;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// Pick the brightest star of `indices` and OR FLAG_BINARY_PRIMARY onto it.
// Returns the picked index, or -1 if the group is empty.
//
// Idempotent: re-running on a group whose primary is already flagged
// produces the same flag bits.
export function markPrimary(
  stars: Pick<BinaryStar, 'absmag' | 'flags'>[],
  indices: number[],
): number {
  const bestIdx = pickBrightest(stars, indices);
  if (bestIdx === -1) return -1;
  stars[bestIdx].flags |= FLAG_BINARY_PRIMARY;
  return bestIdx;
}

// Vetoes a freshly-picked primary before its FLAG_BINARY_PRIMARY bit is
// set — the CCDM optical-double gate (see isOpticalDoublePrimary).
export type SuppressPredicate = (
  primaryIdx: number,
  memberIndices: number[],
) => boolean;

// Like markPrimary, but a no-op when any star in `indices` already carries
// FLAG_BINARY_PRIMARY. Used by the CCDM pass: a star flagged by
// inferBinaries' mutual-pair pick should not get re-picked here, since
// the two passes can disagree on which of a triple is "primary" (e.g. a
// non-mutual {A, B, C} where the geometric pair is (B, C) but A is
// brightest in the CCDM group). Honouring the existing pick keeps the
// "at most one primary per physical system" contract — re-flagging would
// produce two wings glyphs for the same system.
//
// `suppress`, when supplied, vetoes the fresh flag after the primary is
// picked but before the bit is set (the CCDM optical-double gate). The
// already-flagged short-circuit runs first, so a primary the geometric
// pass already winged is never subject to suppression.
//
// Returns the picked index, -1 if no in-catalog members, -2 if a member
// was already flagged, or -3 if `suppress` vetoed the pick.
export function markPrimaryIfUnflagged(
  stars: Pick<BinaryStar, 'absmag' | 'flags'>[],
  indices: number[],
  suppress?: SuppressPredicate,
): number {
  if (indices.length === 0) return -1;
  for (const i of indices) {
    if ((stars[i].flags & FLAG_BINARY_PRIMARY) !== 0) return -2;
  }
  const bestIdx = pickBrightest(stars, indices);
  if (bestIdx === -1) return -1;
  if (suppress?.(bestIdx, indices)) return -3;
  stars[bestIdx].flags |= FLAG_BINARY_PRIMARY;
  return bestIdx;
}

// Apply FLAG_BINARY_PRIMARY across an iterable of HIP-indexed groups. Each
// group's brightest in-catalog component (lowest absmag) gets the bit,
// idempotent with any pre-existing flags from `inferBinaries` (the
// geometric mutual-pair pass can have already marked one member). Groups
// with no in-catalog members are silently skipped.
//
// The `groups` iterable is the union of CCDM groups parsed from the
// Hipparcos cross-reference and the curated `KNOWN_VISUAL_DOUBLES`
// overrides — the caller (build-catalog) constructs the union; this
// helper just walks it.
//
// `suppress` (optional) is forwarded to `markPrimaryIfUnflagged` to veto
// optical doubles — see isOpticalDoublePrimary.
//
// Returns:
//   systems     — count of groups that resolved at least one in-catalog HIP.
//   flagged     — count of groups where this pass set a fresh primary
//                 (i.e. excludes groups whose primary was already set by a
//                 prior pass).
//   suppressed  — count of groups whose fresh primary was vetoed as an
//                 optical double.
//
// Mutates `stars[i].flags` in place via `markPrimaryIfUnflagged`. Pure
// otherwise — does not read or write any other fields.
export interface DoublesStar { absmag: number; flags: number; hip: number | null; }

// HIP → record-index lookup over a star list. When the same HIP appears
// on multiple rows (rare; binary companions sharing an identifier), the
// FIRST occurrence wins via the `!has` check — so against the
// absmag-sorted star array build-catalog.ts produces, the value is the
// brightest row. Shared between the constellation stick-figure resolver
// and the CCDM doubles pass so the two never disagree on a duplicate.
export function buildHipToIndex(
  stars: { hip: number | null }[],
): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i < stars.length; i++) {
    const h = stars[i].hip;
    if (h !== null && h > 0 && !m.has(h)) m.set(h, i);
  }
  return m;
}

export function applyDoublesFlag(
  stars: DoublesStar[],
  groups: Iterable<Iterable<number>>,
  hipToIndex: Map<number, number>,
  suppress?: SuppressPredicate,
): { systems: number; flagged: number; suppressed: number } {
  let systems = 0;
  let flagged = 0;
  let suppressed = 0;
  for (const hips of groups) {
    const indices: number[] = [];
    for (const h of hips) {
      const idx = hipToIndex.get(h);
      if (idx !== undefined) indices.push(idx);
    }
    if (indices.length === 0) continue;
    systems++;
    const picked = markPrimaryIfUnflagged(stars, indices, suppress);
    if (picked >= 0) flagged++;
    else if (picked === -3) suppressed++;
  }
  return { systems, flagged, suppressed };
}

// ---- CCDM optical-double suppression ------------------------------------

// Bound stellar pairs sit within the Galactic tidal-disruption limit for
// field binaries (~1 pc); a wider 3D split is a line-of-sight optical
// double. Mirrors the binaries pipeline's Stage-5 SEPARATION_LIMIT_PC.
export const OPTICAL_DOUBLE_MIN_SEP_PC = 1.0;

// Fields isOpticalDoublePrimary reads. Star satisfies this structurally.
export interface OpticalDoubleStar {
  absmag: number;
  x: number;
  y: number;
  z: number;
  hip: number | null;
  gaiaSourceId: string | null;
  athygDistSrc: string | null;
  varType: number;
}

export interface OpticalDoubleContext {
  // HIPs / Gaia source_ids that are a component of a kept physical pair in
  // data/binaries/multiples.tsv (Stage 5 classified them bound), unioned
  // with the curated KNOWN_VISUAL_DOUBLES. A primary in either set has
  // independent physical evidence — its wings stand regardless of CCDM
  // group geometry.
  physicalHips: ReadonlySet<number>;
  physicalGaia: ReadonlySet<string>;
  minSepPc: number;
}

// A star's distance is Gaia-quality — a Gaia DR3 parallax or its
// Bailer-Jones posterior — iff its AT-HYG dist_src marks the distance as a
// Gaia inverse-parallax (the final distance is then G_R3 or the BJ
// override). Same set as B-J eligibility: both mean "Gaia-anchored". Only
// such distances are trusted for the 3D-separation optical test.
export function isGaiaQualityDist(distSrc: string | null): boolean {
  return distSrc !== null && BJ_ELIGIBLE_DIST_SRCS.has(distSrc);
}

// True when a CCDM group's picked primary should NOT be winged: it's an
// optical double with no independent physical evidence. See
// scripts/catalog/README.md § CCDM double-star cross-match.
//
// Suppression fires only on positive evidence the asserted pair is optical
// — the nearest same-group sibling with a Gaia-quality distance sits
// farther than ctx.minSepPc in 3D. It never fires on mere absence of
// physical evidence, so a noisy parallax can't strip real wings. Keeps the
// wings (returns false) when any holds:
//  - the primary is a component of a kept physical pair, or eclipsing
//    (extrinsic wings earned) — the geometric mutual-pair flag is honoured
//    upstream by markPrimaryIfUnflagged's already-flagged short-circuit;
//  - the primary lacks a Gaia-quality distance (separation untrustworthy);
//  - no same-group sibling with a Gaia-quality distance exists to measure.
export function isOpticalDoublePrimary(
  primaryIdx: number,
  memberIndices: number[],
  stars: OpticalDoubleStar[],
  ctx: OpticalDoubleContext,
): boolean {
  const p = stars[primaryIdx];
  if (p.varType === VAR_TYPE_ECLIPSING) return false;
  if (p.hip !== null && ctx.physicalHips.has(p.hip)) return false;
  if (p.gaiaSourceId !== null && ctx.physicalGaia.has(p.gaiaSourceId)) return false;
  if (!isGaiaQualityDist(p.athygDistSrc)) return false;

  let nearestSq = Infinity;
  for (const j of memberIndices) {
    if (j === primaryIdx) continue;
    const q = stars[j];
    if (!isGaiaQualityDist(q.athygDistSrc)) continue;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const dz = q.z - p.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < nearestSq) nearestSq = d2;
  }
  if (nearestSq === Infinity) return false;
  return nearestSq > ctx.minSepPc * ctx.minSepPc;
}

// Spatial-grid nearest-neighbour pass. For each star, find its nearest
// neighbour within BINARY_MAX_SEP_PC and record it as `companionIdx`.
// `companionIdx` is the **directed** nearest neighbour (A's nearest may
// be B while B's nearest is some third star C); the renderer reads it
// as "the partner for SVG disc-mask cutouts and chart-mode wings,"
// which is well-defined even when the relationship is one-way.
//
// The `0x10` flag is stricter: set only on the brighter member of a
// **mutual** pair (A's nearest is B AND B's nearest is A). The chart-
// mode wings glyph is anchored on `0x10`, so mutual-only avoids
// over-flagging in dense clusters where one star's nearest happens to
// be a third star that's actually paired with someone else.
//
// Mutates `stars[i].companionIdx` and `stars[i].flags` in place.
// Returns counts for the build-time log line:
//   pairs        — total directed companion assignments
//   mutualPairs  — undirected mutual pairs (each counted once); also
//                  equals the count of FLAG_BINARY_PRIMARY bits set,
//                  since we mark exactly one primary per mutual pair
export function inferBinaries(
  stars: BinaryStar[],
): { pairs: number; mutualPairs: number } {
  const cell = BINARY_MAX_SEP_PC;
  const cellInv = 1 / cell;
  const grid = new Map<number, number[]>();
  const n = stars.length;

  const hashKey = (ix: number, iy: number, iz: number): number =>
    ix * 73856093 + iy * 19349663 + iz * 83492791;

  for (let i = 0; i < n; i++) {
    const s = stars[i];
    const ix = Math.floor(s.x * cellInv);
    const iy = Math.floor(s.y * cellInv);
    const iz = Math.floor(s.z * cellInv);
    const key = hashKey(ix, iy, iz);
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
  }

  const sepSq = BINARY_MAX_SEP_PC * BINARY_MAX_SEP_PC;
  let pairs = 0;

  for (let i = 0; i < n; i++) {
    const s = stars[i];
    const ix = Math.floor(s.x * cellInv);
    const iy = Math.floor(s.y * cellInv);
    const iz = Math.floor(s.z * cellInv);
    let bestIdx = -1;
    let bestSq = sepSq;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(hashKey(ix + dx, iy + dy, iz + dz));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j === i) continue;
            const t = stars[j];
            const dxv = t.x - s.x;
            const dyv = t.y - s.y;
            const dzv = t.z - s.z;
            const d2 = dxv * dxv + dyv * dyv + dzv * dzv;
            if (d2 < bestSq) {
              bestSq = d2;
              bestIdx = j;
            }
          }
        }
      }
    }
    if (bestIdx !== -1) {
      stars[i].companionIdx = bestIdx;
      pairs++;
    }
  }

  // Second pass: identify mutual pairs (A↔B where each is the other's
  // directed nearest) and flag the brighter member as primary. Iterate
  // i < j to count each pair exactly once.
  let mutualPairs = 0;
  for (let i = 0; i < n; i++) {
    const j = stars[i].companionIdx;
    if (j < 0 || j <= i) continue;
    if (stars[j].companionIdx !== i) continue;
    mutualPairs++;
    markPrimary(stars, [i, j]);
  }

  return { pairs, mutualPairs };
}

// ---- Bailer-Jones (DR3) distance override -------------------------------

// dist_src tag emitted when a star's distance was supplanted by the
// Bailer-Jones 2021 (DR3) photogeometric / geometric posterior. Joins
// AT-HYG's existing namespace (G_R3, G_R2, HIP, GJ, N, OTHER).
export const DIST_SRC_BAILER_JONES = 'BJ';

// AT-HYG `dist_src` values whose underlying distance is a Gaia
// inverse-parallax estimate. Only these rows are eligible for the
// Bailer-Jones override — for low-S/N Gaia parallaxes the inverse is
// catastrophic and B-J's posterior is the principled replacement.
// Rows whose dist_src is HIP / GJ / N / OTHER already carry a
// non-Gaia parallax or canonical distance; overriding them with B-J
// regresses them onto B-J's Galactic-density prior tail (~10–40 kpc
// at mid-latitudes), which is a strict loss of information.
export const BJ_ELIGIBLE_DIST_SRCS: ReadonlySet<string> = new Set(['G_R3', 'G_R2']);

/** Whether an AT-HYG row is eligible for the Bailer-Jones override:
 *  has a Gaia DR3 source_id AND its AT-HYG dist_src marks the
 *  catalogued distance as a Gaia inverse-parallax estimate. */
export function isBailerJonesEligible(
  gaiaSourceId: string | null,
  distSrc: string | null,
): boolean {
  return !!gaiaSourceId && isGaiaQualityDist(distSrc);
}

/** Parse a Gaia DR3 source_id cell into a decimal string suitable for
 *  `BigInt()`. Returns null for blank cells AND for cells that aren't
 *  pure decimal digits — guards the build's `BigInt(s.gaiaSourceId)`
 *  call against a malformed AT-HYG row throwing a SyntaxError mid-write.
 *  Same `/^\d+$/` shape gate as `parseGaiaHipXmatchTsv` in `gaia-xmatch.ts`. */
export function parseGaiaSourceIdStr(s: string | undefined | null): string | null {
  if (s === undefined || s === null) return null;
  const t = s.trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return null;
  return t;
}

/** Magnitude-consistency gate for Gaia source bindings, shared with the
 *  binaries pipeline: keep equal to GAIA_BINDING_G_MINUS_V_REJECT_MAG in
 *  scripts/binaries/indices.py (catalog-pure.test.ts cross-checks the
 *  Python source text). A bound source more than this much fainter in G
 *  than the star's V is not the star — Gaia's fit fails on saturated
 *  bright stars, so both AT-HYG's `gaia` cell and the
 *  hipparcos2_best_neighbour cross-walk can land on a resolvable
 *  companion or background star instead (Toliman → a G=20.95 source,
 *  Castor → Castor B's source). */
export const GAIA_BINDING_G_MINUS_V_REJECT_MAG = 1.0;

/** Resolve an AT-HYG row's Gaia DR3 source_id, falling back to a
 *  HIP→Gaia cross-walk when the AT-HYG `gaia` column is blank.
 *  Precedence: AT-HYG native > HIP cross-walk; returns null when
 *  neither source has a hit. Gaia-saturated bright binaries (Sirius,
 *  Vega, Procyon, Polaris, Betelgeuse, …) are absent from BOTH
 *  AT-HYG.gaia AND Gaia's `hipparcos2_best_neighbour` cross-walk for
 *  the same physical reason (Gaia's 5-parameter fit fails on
 *  saturated sources), and therefore remain null here. They are
 *  resolved instead through the build-binaries.py pipeline writing
 *  data/binaries/multiples.tsv.
 *
 *  When `vMag` and `gMagOf` are supplied, each candidate binding is
 *  vetted against the magnitude gate above; a rejected native cell
 *  still falls through to the cross-walk (itself vetted). `magRejected`
 *  reports that at least one candidate was scrubbed. */
export function resolveGaiaSourceId(
  gaiaSourceId: string | null,
  hip: number | null,
  hipToGaia: Map<number, string> | null,
  vMag: number | null = null,
  gMagOf: ((sourceId: string) => number | null) | null = null,
): { gaiaSourceId: string | null; backfilled: boolean; magRejected: boolean } {
  const rejects = (id: string): boolean => {
    if (vMag === null || gMagOf === null) return false;
    const g = gMagOf(id);
    return g !== null && g - vMag > GAIA_BINDING_G_MINUS_V_REJECT_MAG;
  };
  let magRejected = false;
  if (gaiaSourceId) {
    if (!rejects(gaiaSourceId)) {
      return { gaiaSourceId, backfilled: false, magRejected: false };
    }
    magRejected = true;
  }
  if (hip === null || hip <= 0 || !hipToGaia) {
    return { gaiaSourceId: null, backfilled: false, magRejected };
  }
  const hit = hipToGaia.get(hip);
  if (!hit) return { gaiaSourceId: null, backfilled: false, magRejected };
  if (rejects(hit)) return { gaiaSourceId: null, backfilled: false, magRejected: true };
  return { gaiaSourceId: hit, backfilled: true, magRejected };
}

/** Parse the TSV produced by `scripts/refresh/refresh-bailer-jones.py` into a
 *  Gaia DR3 source_id → distance (pc) map. `source_id` is kept as a
 *  string: Gaia source_ids exceed `Number.MAX_SAFE_INTEGER`, so any
 *  numeric parse would silently corrupt the join key.
 *
 *  Per Bailer-Jones 2021, `r_med_photogeo` is preferred when available
 *  (combines the parallax likelihood with a colour-and-magnitude
 *  population prior); `r_med_geo` is the geometric-only fallback for
 *  rows without photogeo (no usable G or BP–RP). */
export function parseBailerJonesTsv(text: string): Map<string, number> {
  const out = new Map<string, number>();
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return out;
  const header = lines[0].split('\t').map((h) => h.trim());
  const idIdx = header.indexOf('source_id');
  const geoIdx = header.indexOf('r_med_geo');
  const photogeoIdx = header.indexOf('r_med_photogeo');
  const missing: string[] = [];
  if (idIdx < 0) missing.push('source_id');
  if (geoIdx < 0) missing.push('r_med_geo');
  if (photogeoIdx < 0) missing.push('r_med_photogeo');
  if (missing.length) {
    throw new Error(
      `Bailer-Jones TSV is missing required columns: ${missing.join(', ')}. ` +
        `Re-run scripts/refresh/refresh-bailer-jones.py.`,
    );
  }
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = line.split('\t');
    const sourceId = (cells[idIdx] ?? '').trim();
    if (!sourceId) continue;
    const photogeo = parseFloat((cells[photogeoIdx] ?? '').trim());
    const geo = parseFloat((cells[geoIdx] ?? '').trim());
    const d = Number.isFinite(photogeo)
      ? photogeo
      : Number.isFinite(geo) ? geo : NaN;
    if (!Number.isFinite(d) || d <= 0) continue;
    out.set(sourceId, d);
  }
  return out;
}

// ---- Gaia DR3 Apsis astrophysical parameters ----------------------------

/** Per-source Apsis fields from `data/gaia/gaia_dr3_apsis.tsv`. The seven
 *  float columns (gspphot ∪ gspspec) are `number | null` — gspphot and
 *  gspspec are independent solutions and either or both may be absent
 *  for a given source_id. NaN-when-empty decoding lifts to the binary
 *  layer via `NO_APSIS`. `spectraltypeEsphs` is the GSP-Spec spectral-type
 *  enum (Recio-Blanco+23): one of "O", "B", "A", "F", "G", "K", "M",
 *  "CSTAR", or "unknown"; consumed by the spectral resolver as the
 *  second tier after SIMBAD sp_type. */
export interface ApsisRow {
  teffGspphot: number | null;
  loggGspphot: number | null;
  mhGspphot: number | null;
  azeroGspphot: number | null;
  teffGspspec: number | null;
  loggGspspec: number | null;
  mhGspspec: number | null;
  spectraltypeEsphs: string | null;
}

/** Parse the TSV produced by `scripts/refresh/refresh-gaia-apsis.py` into
 *  a Gaia DR3 source_id → ApsisRow map. `source_id` is kept as a string:
 *  Gaia source_ids exceed Number.MAX_SAFE_INTEGER so any numeric parse
 *  would silently corrupt the join key. Blank cells decode to `null` —
 *  the writer maps `null` to `NO_APSIS` (NaN) at pack time. */
export function parseGaiaApsisTsv(text: string): Map<string, ApsisRow> {
  const out = new Map<string, ApsisRow>();
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return out;
  const header = lines[0].split('\t').map((h) => h.trim());
  const cols = [
    'source_id',
    'teff_gspphot', 'logg_gspphot', 'mh_gspphot', 'azero_gspphot',
    'teff_gspspec', 'logg_gspspec', 'mh_gspspec',
    'spectraltype_esphs',
  ] as const;
  const idx: Record<(typeof cols)[number], number> = Object.create(null);
  const missing: string[] = [];
  for (const c of cols) {
    const i = header.indexOf(c);
    if (i < 0) missing.push(c);
    idx[c] = i;
  }
  if (missing.length) {
    throw new Error(
      `Gaia DR3 Apsis TSV is missing required columns: ${missing.join(', ')}. ` +
        `Re-run scripts/refresh/refresh-gaia-apsis.py.`,
    );
  }
  const cell = (cells: string[], i: number): number | null => {
    const s = (cells[i] ?? '').trim();
    if (!s) return null;
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : null;
  };
  const strCell = (cells: string[], i: number): string | null => {
    const s = (cells[i] ?? '').trim();
    return s ? s : null;
  };
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = line.split('\t');
    const sourceId = (cells[idx.source_id] ?? '').trim();
    if (!sourceId) continue;
    out.set(sourceId, {
      teffGspphot: cell(cells, idx.teff_gspphot),
      loggGspphot: cell(cells, idx.logg_gspphot),
      mhGspphot: cell(cells, idx.mh_gspphot),
      azeroGspphot: cell(cells, idx.azero_gspphot),
      teffGspspec: cell(cells, idx.teff_gspspec),
      loggGspspec: cell(cells, idx.logg_gspspec),
      mhGspspec: cell(cells, idx.mh_gspspec),
      spectraltypeEsphs: strCell(cells, idx.spectraltype_esphs),
    });
  }
  return out;
}

// ---- SIMBAD spectral classification --------------------------------------

/** Per-source SIMBAD spectral-classification row from
 *  `data/simbad/simbad_sptype.tsv`. `spType` is the canonical
 *  Morgan-Keenan string (free of variability-type contamination by
 *  SIMBAD's schema split). `spQual` is the per-row quality letter
 *  (A=best, … E=worst); `otype` is SIMBAD's object-type classification
 *  (separate column — never bleeds into sp_type). Both carried for
 *  display + future filtering, but the spectral resolver consumes only
 *  spType. */
export interface SimbadSpectralRow {
  spType: string | null;
  spQual: string | null;
  otype: string | null;
}

/** Dual-keyed SIMBAD sp_type lookup. `bySource` is keyed by Gaia DR3
 *  source_id; `byHip` by Hipparcos number. The HIP index carries the
 *  Gaia-saturated bright stars (Algol, Alsephina, ~700 others) whose
 *  SIMBAD row has a valid sp_type but no source_id — see
 *  resolveSpectralInfo's HIP tier. */
export interface SimbadSpectralIndex {
  bySource: Map<string, SimbadSpectralRow>;
  byHip: Map<number, SimbadSpectralRow>;
}

/** Parse the TSV produced by `scripts/refresh/refresh-simbad-sptype.py`
 *  into a `SimbadSpectralIndex`. source_id is kept as a string for the
 *  same > Number.MAX_SAFE_INTEGER reason that `parseGaiaApsisTsv` uses.
 *  A row is indexed under whichever of source_id / hip it carries (the
 *  TSV's WDS-only HIP→oid joins have no source_id but a usable HIP);
 *  a row with neither is unindexable and skipped. `byHip` is
 *  first-write-wins to match the byGaia/byHip convention elsewhere. */
export function parseSimbadSptypeTsv(text: string): SimbadSpectralIndex {
  const bySource = new Map<string, SimbadSpectralRow>();
  const byHip = new Map<number, SimbadSpectralRow>();
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return { bySource, byHip };
  const header = lines[0].split('\t').map((h) => h.trim());
  const idIdx = header.indexOf('source_id');
  const hipIdx = header.indexOf('hip');
  const spTypeIdx = header.indexOf('sp_type');
  const spQualIdx = header.indexOf('sp_qual');
  const otypeIdx = header.indexOf('otype');
  const missing: string[] = [];
  if (idIdx < 0) missing.push('source_id');
  if (spTypeIdx < 0) missing.push('sp_type');
  if (missing.length) {
    throw new Error(
      `SIMBAD sptype TSV missing required columns: ${missing.join(', ')}. ` +
        `Re-run scripts/refresh/refresh-simbad-sptype.py.`,
    );
  }
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = line.split('\t');
    const sourceId = (cells[idIdx] ?? '').trim();
    const hipRaw = hipIdx >= 0 ? (cells[hipIdx] ?? '').trim() : '';
    if (!sourceId && !hipRaw) continue;
    const spType = (cells[spTypeIdx] ?? '').trim() || null;
    const spQual = spQualIdx >= 0 ? ((cells[spQualIdx] ?? '').trim() || null) : null;
    const otype = otypeIdx >= 0 ? ((cells[otypeIdx] ?? '').trim() || null) : null;
    const row: SimbadSpectralRow = { spType, spQual, otype };
    if (sourceId) bySource.set(sourceId, row);
    const hipNum = hipRaw ? Number(hipRaw) : NaN;
    if (Number.isInteger(hipNum) && hipNum > 0 && !byHip.has(hipNum)) {
      byHip.set(hipNum, row);
    }
  }
  return { bySource, byHip };
}

/** Apparent magnitude → absolute magnitude at given distance.
 *  M = m − 5·log₁₀(d / 10 pc). */
export function apparentToAbsoluteMagnitude(mag: number, distPc: number): number {
  return mag - 5 * Math.log10(distPc / 10);
}

/** Shared shape produced by every distance-override layer (Bailer-Jones,
 *  LMC kinematic, and future SMC kinematic / structural-disc / OGLE
 *  Cepheid layers). Each `apply*Override` returns one of these or null.
 *  Recomputing absmag with the snapped distance is essential — without
 *  it, stars get placed at the new distance but lit for the old one.
 *  xyz is NOT part of the shape: position is direction × distance, with
 *  the direction resolved independently by the direction cascade. */
export interface DistanceOverride {
  dist: number;
  absmag: number;
}

/** Single source of truth for assembling a `DistanceOverride` from a
 *  snapped distance. */
export function buildDistanceOverride(mag: number, distPc: number): DistanceOverride {
  return {
    dist: distPc,
    absmag: apparentToAbsoluteMagnitude(mag, distPc),
  };
}

/** When `gaiaSourceId` has a Bailer-Jones entry, returns the override
 *  for that star; otherwise null. The caller swaps the fields into the
 *  star record and tags `dist_src = "BJ"`. */
export function applyBailerJonesOverride(
  mag: number,
  gaiaSourceId: string | null,
  bjMap: Map<string, number>,
): DistanceOverride | null {
  if (!gaiaSourceId) return null;
  const dist = bjMap.get(gaiaSourceId);
  if (dist === undefined) return null;
  return buildDistanceOverride(mag, dist);
}

// ---- LMC kinematic distance override -------------------------------------

// dist_src tag for stars whose distance was set by the LMC kinematic
// filter (sky cone + bulk proper motion). Runs AFTER the Bailer-Jones
// override so it wins on stars that also have a Gaia source_id — without
// this layer, B-J's smooth Galactic prior smears LMC supergiants to
// ~5-20 kpc (B-J's prior has no LMC), regressing today's behaviour for
// ~60 AT-HYG entries in the LMC field.
export const DIST_SRC_LMC_KIN = 'LMC_KIN';

// LMC kinematic parameters. References:
//   - Pietrzyński et al. 2019 (Nature 567, 200): eclipsing-binary distance
//     49.594 ± 0.55 kpc.
//   - van der Marel & Kallivayalil 2014 (ApJ 781, 121): LMC centre of mass
//     bulk proper motion μ_α* cos δ ≈ +1.91 ± 0.02, μ_δ ≈ +0.23 ± 0.05 mas/yr.
//   - LMC photometric centre: (RA, Dec) ≈ (05h 23m 34s, −69° 45′) = (78.76°,
//     −69.19°). The 15° cone is wide enough to admit the visible disc and
//     30 Doradus while keeping confusion with Galactic foreground low.
// Tolerances chosen so AT-HYG halo / runaway stars in the same sky region
// (which have very different PMs) fail the test — see catalog-pure.test.ts.
export const LMC_DISTANCE_PC = 49_594;
export const LMC_CENTRE_RA_HOURS = 5.25067;       // 78.76° / 15
export const LMC_CENTRE_DEC_DEG = -69.19;
export const LMC_CONE_HALF_ANGLE_DEG = 15;
export const LMC_PM_RA_CENTRE = 1.85;             // mas/yr
export const LMC_PM_DEC_CENTRE = 0.20;            // mas/yr
export const LMC_PM_TOLERANCE = 0.5;              // mas/yr per component

/** Angular separation (degrees) between two ICRS positions. Vector
 *  dot-product form — stable for small and wide separations alike, no
 *  cos/sin of differences. Input RA is hours, Dec is degrees. */
export function angularSeparationDeg(
  raHoursA: number,
  decDegA: number,
  raHoursB: number,
  decDegB: number,
): number {
  const raA = raHoursA * (Math.PI / 12);
  const raB = raHoursB * (Math.PI / 12);
  const decA = decDegA * (Math.PI / 180);
  const decB = decDegB * (Math.PI / 180);
  const cosDecA = Math.cos(decA);
  const cosDecB = Math.cos(decB);
  const ax = cosDecA * Math.cos(raA);
  const ay = cosDecA * Math.sin(raA);
  const az = Math.sin(decA);
  const bx = cosDecB * Math.cos(raB);
  const by = cosDecB * Math.sin(raB);
  const bz = Math.sin(decB);
  const dot = Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz));
  return Math.acos(dot) * (180 / Math.PI);
}

/** Whether (raHours, decDegrees) falls within the LMC sky cone — the
 *  per-row eligibility predicate shared by the LMC kinematic override
 *  and the `lmcCandidates` build-counter. Hoisted out of
 *  `applyLmcKinematicOverride` so callers can evaluate the cone once
 *  per row and reuse the result for both the counter and the override
 *  call, avoiding ~313k redundant `angularSeparationDeg` evaluations. */
export function isInLmcCone(raHours: number, decDegrees: number): boolean {
  const sep = angularSeparationDeg(
    raHours, decDegrees,
    LMC_CENTRE_RA_HOURS, LMC_CENTRE_DEC_DEG,
  );
  return sep <= LMC_CONE_HALF_ANGLE_DEG;
}

/** PRECONDITION: caller has already verified `isInLmcCone(raHours,
 *  decDegrees)`. When (pmRa, pmDec) lies within tolerance of the LMC
 *  bulk-PM centre, returns the override snapped to Pietrzyński 2019's
 *  distance. Otherwise null — caller leaves the row's existing values
 *  in place (which after B-J is either the B-J posterior or AT-HYG's
 *  1/π). The cone check is the caller's responsibility so the
 *  `lmcCandidates` counter and this gate share a single evaluation. */
export function applyLmcKinematicOverride(
  mag: number,
  pmRa: number | null,
  pmDec: number | null,
): DistanceOverride | null {
  if (pmRa === null || pmDec === null) return null;
  if (Math.abs(pmRa - LMC_PM_RA_CENTRE) > LMC_PM_TOLERANCE) return null;
  if (Math.abs(pmDec - LMC_PM_DEC_CENTRE) > LMC_PM_TOLERANCE) return null;
  return buildDistanceOverride(mag, LMC_DISTANCE_PC);
}

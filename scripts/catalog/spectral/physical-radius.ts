// Stefan-Boltzmann radius chain: effective temperature and bolometric
// correction by class, and the absolute-magnitude inverse. See README.md.

import { ballesterosBvFromTeff } from '../../colour/blackbody-lut-pure';
import { SOLAR_BV_FALLBACK, type ApsisRow } from '../catalog-pure';
import {
  SPECTRAL_UNKNOWN,
  UNKNOWN_CLASS_IDX,
  type SpectralInfo,
} from './spectral-classify';

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

/** Intrinsic (extinction-free) B−V from a parsed spectral class — the
 *  build-side tier-4/5/6 colour bake. White dwarfs / class stars route
 *  their `tempKelvin` through Ballesteros; an unparseable class falls to
 *  `SOLAR_BV_FALLBACK` rather than `tempKelvin`'s neutral 5000 K row (a
 *  yellow-white default that would misrepresent an unknown star as solar).
 *  Shared by the main-catalog read (`stars-parse.ts`) and companion
 *  promotion (`imputeCompanionCi`): the shipped shader routing is
 *  two-tier (`iTeffApsis > 0 ? Ballesteros(iTeffApsis) : iCi`), so a
 *  no-Apsis star's class colour has to be baked into `ci` here. The
 *  result is intrinsic and must NOT be de-reddened. */
export function spectralClassCi(info: SpectralInfo): number {
  if (!spectralClassColorIsDerivable(info)) return SOLAR_BV_FALLBACK;
  return ballesterosBvFromTeff(tempKelvin(info));
}

/** True when `spectralClassCi` derives a real class colour rather than
 *  returning `SOLAR_BV_FALLBACK` — a parseable non-WD class, or any white
 *  dwarf. Callers counting the tier-4/5 bake (`ciSpectralDerived`) gate on
 *  this instead of comparing the returned B−V to the fallback value, which
 *  a class landing exactly on 0.65 would miscount. */
export function spectralClassColorIsDerivable(info: SpectralInfo): boolean {
  return !(info === SPECTRAL_UNKNOWN
    || (info.classIdx === UNKNOWN_CLASS_IDX && !info.isWhiteDwarf));
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

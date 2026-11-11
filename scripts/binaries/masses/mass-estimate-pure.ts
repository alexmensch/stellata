// A star's mass in solar masses from its SIMBAD / MK spectral string: the parser and the mass tables. See README.md.

export interface ParsedSpect {
  /** 0-6 = O..M, 7 = carbon / S / Wolf-Rayet, 8 = white dwarf. */
  readonly classIdx: number;
  /** 0-9; 5 where the string states none. */
  readonly subclass: number;
  /** 0 = WD .. 9 = hypergiant, the record's lumClass byte; 255 = unknown. */
  readonly lumClass: number;
  readonly isWhiteDwarf: boolean;
}

const CLASS_IDX: Readonly<Record<string, number>> = {
  O: 0, B: 1, A: 2, F: 3, G: 4, K: 5, M: 6,
  C: 7, S: 7, W: 7, N: 7, R: 7,
};
const CARBON_CLASS_IDX = 7;
const UNKNOWN_CLASS_IDX = 8;
const UNKNOWN_LUM_CLASS = 255;
const DEFAULT_SUBCLASS = 5;

const LUM_PREFIXES: readonly (readonly [RegExp, number])[] = [
  [/^IA\+|^0(?!\d)/, 9],
  [/^IAB/, 7],
  [/^IA(?!B)/, 8],
  [/^IB/, 6],
  [/^III/, 4],
  [/^II(?!I)/, 5],
  [/^IV/, 3],
  [/^VII/, 0],
  [/^VI(?!I)/, 1],
  [/^V(?!I)/, 2],
  [/^I(?![IV])/, 7],
];

function lookupLumClass(window: string): number {
  const upper = window.toUpperCase();
  return LUM_PREFIXES.find(([pattern]) => pattern.test(upper))?.[1] ?? UNKNOWN_LUM_CLASS;
}

const subclassOf = (digits: string | undefined): number => (digits ? Number(digits[0]) : DEFAULT_SUBCLASS);

export function parseSpectralType(raw: string | null): ParsedSpect | null {
  if (!raw) return null;
  const s = raw.replace(/\s+/g, '');
  if (!s) return null;

  if (/^D[ABCOHQXZV]+/.test(s)) {
    return { classIdx: UNKNOWN_CLASS_IDX, subclass: DEFAULT_SUBCLASS, lumClass: 0, isWhiteDwarf: true };
  }
  const yerkes = s.match(/^([dg])([OBAFGKM])(\d(?:\.\d)?)?/);
  if (yerkes) {
    return { classIdx: CLASS_IDX[yerkes[2]], subclass: subclassOf(yerkes[3]), lumClass: yerkes[1] === 'g' ? 4 : 2, isWhiteDwarf: false };
  }
  const subdwarf = s.match(/^sd([OBAFGKM])(\d(?:\.\d)?)?/);
  if (subdwarf) {
    return { classIdx: CLASS_IDX[subdwarf[1]], subclass: subclassOf(subdwarf[2]), lumClass: 1, isWhiteDwarf: false };
  }

  let body = s;
  let lumWindow = '';
  const composite = [...s.matchAll(/([khm])([OBAFGKM])(\d(?:\.\d)?)?/g)];
  if (composite.length > 0) {
    const bodies: Record<string, string> = { k: '', h: '', m: '' };
    for (const cm of composite) bodies[cm[1]] = cm[2] + (cm[3] ?? '');
    body = bodies.m || bodies.h || bodies.k;
    const last = composite.at(-1)!;
    lumWindow = s.slice(last.index + last[0].length).replace(/^\(+/, '');
  }

  const first = body.slice(0, 1).toUpperCase();
  if (!Object.hasOwn(CLASS_IDX, first)) return null;
  const classIdx = CLASS_IDX[first];
  const sub = body.slice(1).match(/^(\d)(?:\.\d)?/);
  const subclass = sub ? Number(sub[1]) : DEFAULT_SUBCLASS;
  if (classIdx === CARBON_CLASS_IDX) {
    return { classIdx, subclass, lumClass: UNKNOWN_LUM_CLASS, isWhiteDwarf: false };
  }
  if (!lumWindow) lumWindow = body.slice(1 + (sub ? sub[0].length : 0));
  return { classIdx, subclass, lumClass: lookupLumClass(lumWindow), isWhiteDwarf: false };
}

/** Main-sequence masses, rows O..M, columns subclass 0..9: Cox 2000 (/data/papers/index.md#cox2000) Sect. 15.2's
 *  anchors, linearly interpolated between them — the subclasses between anchors are not Cox's values. */
const MS_MASS: readonly (readonly number[])[] = [
  [60.0, 50.0, 40.0, 32.0, 28.0, 25.0, 22.0, 20.0, 18.0, 17.0],
  [17.0, 13.0, 9.0, 7.0, 6.5, 5.9, 4.5, 3.8, 3.3, 3.0],
  [2.9, 2.6, 2.4, 2.2, 2.1, 2.0, 1.85, 1.75, 1.65, 1.55],
  [1.6, 1.55, 1.5, 1.46, 1.42, 1.4, 1.3, 1.2, 1.12, 1.07],
  [1.05, 1.02, 1.0, 0.98, 0.96, 0.95, 0.92, 0.88, 0.83, 0.80],
  [0.80, 0.76, 0.72, 0.70, 0.68, 0.65, 0.58, 0.54, 0.50, 0.48],
  [0.50, 0.42, 0.36, 0.32, 0.28, 0.20, 0.13, 0.09, 0.07, 0.05],
];

/** Giant (III, and II) masses: Cox 2000 (/data/papers/index.md#cox2000) Table 15.7; the O row is extrapolated, not read off the table. */
const III_MASS: readonly (readonly number[])[] = [
  Array(10).fill(40.0),
  [15.0, 13.0, 11.0, 9.0, 8.0, 7.0, 6.5, 6.0, 5.5, 5.0],
  [4.0, 3.8, 3.5, 3.2, 3.0, 2.8, 2.6, 2.4, 2.3, 2.2],
  [2.2, 2.1, 2.0, 1.9, 1.8, 1.8, 1.7, 1.6, 1.6, 1.6],
  [2.5, 2.3, 2.1, 2.0, 1.9, 1.9, 1.8, 1.7, 1.6, 1.6],
  [1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.4, 1.4, 1.4, 1.4],
  [1.5, 1.4, 1.4, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3],
];

/** Supergiant (Ia+, Ia, Iab, Ib) masses: Cox 2000 (/data/papers/index.md#cox2000) Table 15.7, one row for every tier. */
const I_MASS: readonly (readonly number[])[] = [
  [70.0, 60.0, 50.0, 45.0, 40.0, 35.0, 32.0, 30.0, 28.0, 27.0],
  [25.0, 22.0, 20.0, 18.0, 16.0, 14.0, 13.0, 12.0, 11.0, 10.0],
  [16.0, 15.0, 14.0, 13.0, 12.0, 12.0, 11.0, 11.0, 10.0, 10.0],
  Array(10).fill(12.0),
  [12.0, 12.0, 13.0, 13.0, 13.0, 13.0, 14.0, 14.0, 14.0, 14.0],
  [14.0, 14.0, 14.0, 14.0, 14.0, 14.0, 15.0, 15.0, 15.0, 15.0],
  [16.0, 16.0, 16.0, 16.0, 17.0, 17.0, 17.0, 17.0, 18.0, 18.0],
];

/** A subgiant (IV) mass weights the giant row over the main-sequence one; F5IV is pinned against Procyon A. */
export const IV_GIANT_WEIGHT = 0.55;
const IV_MS_WEIGHT = 1.0 - IV_GIANT_WEIGHT;

/** Kepler 2007 (/data/papers/index.md#kepler2007) DA mean 0.593, Kilic 2020 (/data/papers/index.md#kilic2020) peak 0.59. */
export const WD_MASS_DEFAULT = 0.6;
export const CARBON_WR_MASS_DEFAULT = 3.0;

/** Null for an empty or unparseable string. */
export function massFromSpectralClass(spect: string | null): number | null {
  const parsed = parseSpectralType(spect);
  if (parsed === null) return null;
  if (parsed.isWhiteDwarf) return WD_MASS_DEFAULT;
  if (parsed.classIdx === CARBON_CLASS_IDX) return CARBON_WR_MASS_DEFAULT;
  if (parsed.classIdx === UNKNOWN_CLASS_IDX) return null;
  const c = parsed.classIdx;
  const sub = Math.max(0, Math.min(9, parsed.subclass));
  switch (parsed.lumClass) {
    case 0: return WD_MASS_DEFAULT;
    case 4: case 5: return III_MASS[c][sub];
    case 3: return IV_GIANT_WEIGHT * III_MASS[c][sub] + IV_MS_WEIGHT * MS_MASS[c][sub];
    case 6: case 7: case 8: case 9: return I_MASS[c][sub];
    default: return MS_MASS[c][sub];
  }
}

/** q = M₂ / (M₁ + M₂) from both components' types; null when either has no mass. */
export function massRatioFromComponents(primarySpect: string | null, secondarySpect: string | null): number | null {
  const mA = massFromSpectralClass(primarySpect);
  const mB = massFromSpectralClass(secondarySpect);
  if (mA === null || mB === null || mA + mB <= 0) return null;
  return mB / (mA + mB);
}

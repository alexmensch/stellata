// Morgan-Keenan spectral-string parsing: the SIMBAD MK walker, the GSP-Spec
// letter enum, and the SpectralInfo variant both produce. See README.md.

/** O B A F G K M, in temperature order. */
export type MkLetter = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// Luminosity class:
//   0 = VII / D  (white dwarf)        5 = II        (bright giant)
//   1 = VI / sd  (subdwarf)           6 = Ib        (less-luminous supergiant)
//   2 = V        (main sequence)      7 = Iab       (intermediate supergiant)
//   3 = IV       (subgiant)           8 = Ia        (luminous supergiant)
//   4 = III      (giant)              9 = Ia+ / 0   (hypergiant)
export type LumClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
/** VII is a white dwarf, which is its own kind. */
export type MkLumClass = Exclude<LumClass, 0>;

/** The subclass the tables read a class at when its source states none. */
export const DEFAULT_SUBCLASS = 5;

/** `null` subclass / index / luminosity class: the source stated none. */
export type SpectralInfo =
  | { kind: 'mk'; letter: MkLetter; subclass: number | null; lumClass: MkLumClass | null }
  | { kind: 'carbon'; subclass: number | null }
  /** WN/WC: rides the WR Teff/BC ramps — the carbon row misizes a ~40-140 kK
   *  WR photosphere by ~(T ratio)² ≈ 1000×. */
  | { kind: 'wolf-rayet'; subclass: number | null }
  /** `wdSubclass` is the Sion temperature index, the digit after D. */
  | { kind: 'white-dwarf'; wdSubclass: number | null }
  | { kind: 'unknown' };

export type MkSpectral = Exclude<SpectralInfo, { kind: 'unknown' }>;

export const SPECTRAL_UNKNOWN: SpectralInfo = { kind: 'unknown' };

const MK_LETTERS = 'OBAFGKM';
const CARBON_FAMILY_RE = /[CSWNR]/;

function mkLetter(c: string): MkLetter | null {
  const i = c ? MK_LETTERS.indexOf(c) : -1;
  return i < 0 ? null : (i as MkLetter);
}

// Roman luminosity-class lookup, longest prefix first so "III" never
// matches as "II" + "I".
const LUMINOSITY_PREFIXES: ReadonlyArray<readonly [RegExp, LumClass]> = [
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

function lookupLumClass(window: string): LumClass | null {
  // SIMBAD writes Roman luminosity-class suffixes mixed-case — uppercase
  // I/V plus lowercase a/b ("Ia", "Iab", "Ib"). Fold to uppercase once
  // here so each per-pattern regex stays case-sensitive (and won't
  // accidentally match elsewhere in the string).
  const upper = window.toUpperCase();
  for (const [re, lc] of LUMINOSITY_PREFIXES) {
    if (re.test(upper)) return lc;
  }
  return null;
}

/** Strict Morgan-Keenan classifier for SIMBAD-canonical `sp_type`
 *  strings; returns null on unparseable input. See
 *  /scripts/catalog/spectral/README.md#the-resolver for
 *  handled shapes and the Am/Ap composite-tag preference order. */
export function classifyFromSimbad(rawSpType: string | null | undefined): MkSpectral | null {
  if (!rawSpType) return null;
  const s = rawSpType.replace(/\s+/g, '');
  if (!s) return null;

  // Yerkes lowercase prefix: "d" = dwarf (lumClass V), "g" = giant (III).
  // SIMBAD keeps the convention on nearby M dwarfs / late-type giants
  // ("dM4.0", "gK0"). The prefix IS the luminosity declaration, so any
  // trailing Roman is overridden. Without this short-circuit the
  // first-char gate further down rejects the leading lowercase letter
  // and the row leaks to the GSP-Spec tier.
  const yerkesMatch = s.match(/^([dg])([OBAFGKM])/);
  if (yerkesMatch) {
    const subMatch = s.substring(2).match(/^(\d)(?:\.\d)?/);
    return {
      kind: 'mk',
      letter: mkLetter(yerkesMatch[2]) as MkLetter,
      subclass: subMatch ? Number(subMatch[1]) : null,
      lumClass: yerkesMatch[1] === 'g' ? 4 : 2,
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
    const wdSubclass = wdMatch[1]
      ? Math.max(0, Math.min(9, Math.round(Number(wdMatch[1]))))
      : null;
    return { kind: 'white-dwarf', wdSubclass };
  }

  // Subdwarf prefix: "sdB", "sdO", etc. → lumClass=1 (subdwarf).
  const sdMatch = s.match(/^sd([OBAFGKM])(\d(?:\.\d)?)?/);
  if (sdMatch) {
    return {
      kind: 'mk',
      letter: mkLetter(sdMatch[1]) as MkLetter,
      subclass: sdMatch[2] ? Number(sdMatch[2].split('.')[0]) : null,
      lumClass: 1,
    };
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
  const letter = mkLetter(firstChar);
  if (letter === null && !CARBON_FAMILY_RE.test(firstChar)) return null;

  // Subclass digit: take the integer part of an optionally-fractional digit.
  let subclass: number | null = null;
  let afterSub = 1;
  const subMatch = body.substring(1).match(/^(\d)(?:\.\d)?/);
  if (subMatch) {
    subclass = Number(subMatch[1]);
    afterSub += subMatch[0].length;
  }

  // Carbon / S / Wolf-Rayet: no luminosity-class slot. SIMBAD writes carbon
  // stars as "C5,2e" (subclass + abundance index) and Wolf-Rayets as
  // "WN5" / "WC4"; both lack a Roman luminosity class.
  if (letter === null) {
    if (firstChar === 'W') {
      // WR+MK composites (γ² Vel "WC8+O7.5III-V"): the WR catalog
      // convention lists the WR first regardless of optical brightness,
      // but the MK companion dominates the V light the record's absmag
      // measures — classify by it (the Antares M+B convention already
      // classifies by the V-dominant first-listed component).
      const plus = body.indexOf('+');
      if (plus >= 0) {
        const companion = classifyFromSimbad(body.substring(plus + 1));
        if (companion?.kind === 'mk') return companion;
      }
      // The WR ionization subclass sits after the two-letter WN/WC/WO
      // prefix ("WN5", "WC4"), which the generic position-1 digit parse
      // above never reaches.
      const wrSub = body.match(/^W[NCO]?(\d)(?:\.\d)?/);
      return { kind: 'wolf-rayet', subclass: wrSub ? Number(wrSub[1]) : subclass };
    }
    return { kind: 'carbon', subclass };
  }

  if (!lumWindow) {
    lumWindow = body.substring(afterSub);
  }
  const lumClass = lookupLumClass(lumWindow);
  return lumClass === 0
    ? { kind: 'white-dwarf', wdSubclass: null }
    : { kind: 'mk', letter, subclass, lumClass };
}

/** Gaia DR3 ESP-ELS's letter-only `spectraltype_esphs` enum (Creevey 2023
 *  (/data/papers/index.md#creevey2023)). Null for "unknown" and unrecognised
 *  letters. */
export function classifyFromGspspec(
  esphs: string | null | undefined,
): Extract<SpectralInfo, { kind: 'mk' | 'carbon' }> | null {
  if (!esphs) return null;
  const s = esphs.trim().toUpperCase();
  if (!s || s === 'UNKNOWN') return null;
  if (s === 'CSTAR') return { kind: 'carbon', subclass: null };
  const letter = mkLetter(s.charAt(0));
  return letter === null ? null : { kind: 'mk', letter, subclass: null, lumClass: null };
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

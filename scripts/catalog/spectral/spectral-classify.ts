// Morgan-Keenan spectral-string parsing: the SIMBAD MK walker, the GSP-Spec
// letter enum, and the SpectralInfo shape both produce. See README.md.


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
 *  README.md § The resolver and the radius chain for
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

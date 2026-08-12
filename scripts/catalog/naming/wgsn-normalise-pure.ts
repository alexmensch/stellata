// The two designation normalisers of docs/star-naming.md § 4 — NEC's
// `Bayer/other` cell grammar and IV/27A's ASCII Bayer conventions —
// emitting structure (glyph + superscript + dc + component) only.

import { CONSTELLATIONS } from '../parse/constellations';
import {
  ASCII_GREEK,
  CONSTELLATION_GENITIVES,
  foldCurlyGreek,
  GREEK_GLYPHS,
} from './greek-forms';

export interface BayerDesignation {
  /** The Unicode glyph for Greek, the bare letter for Latin (`p`, `L`). */
  letter: string;
  sup: number | null;
  dc: string;
  component: string | null;
}

export interface FlamsteedDesignation {
  num: number;
  dc: string;
  component: string | null;
}

export interface GouldDesignation {
  num: number;
  dc: string;
  component: string | null;
  /** Gould numbered Serpens' two halves separately, so `4 G. Ser Cap` and
   *  `4 G. Ser Cau` are different stars — the number alone is ambiguous
   *  within Ser and the half is part of the designation. */
  serpensHalf: 'Cap' | 'Cau' | null;
}

/** One `Bayer/other` cell, classified. `variable` routes to the GCVS tier
 *  (docs/star-naming.md § 3 tier 6) and is never a Bayer letter;
 *  `non_stellar` (clusters, nebulae, galaxies) and `other_catalogue`
 *  (BD/CD/Gliese/survey ids — the row still keys via HIP/HR/HD) emit no
 *  designation; `corrupt` is the upstream Mathematica artifact on ρ² Ara. */
export type NormalisedCell =
  | { class: 'empty' }
  | { class: 'bayer'; bayer: BayerDesignation }
  | { class: 'flamsteed'; flamsteed: FlamsteedDesignation }
  | { class: 'gould'; gould: GouldDesignation }
  | { class: 'variable'; designation: string }
  | { class: 'non_stellar'; raw: string }
  | { class: 'other_catalogue'; raw: string }
  | { class: 'corrupt'; raw: string };

const IAU_CODES = new Set(CONSTELLATIONS.map((c) => c.code));

// Genitive keys sorted longest-first so 'Canum Venaticorum' wins over a
// one-word attempt; codes are exact-match.
const GENITIVES_BY_LENGTH = Object.keys(CONSTELLATION_GENITIVES)
  .sort((a, b) => b.split(' ').length - a.split(' ').length);

/** Match a constellation at the front of `tokens`: an IAU code token or a
 *  one/two-word genitive. Returns the code and how many tokens it ate. */
function matchConstellation(
  tokens: string[],
): { dc: string; used: number } | null {
  if (tokens.length === 0) return null;
  if (IAU_CODES.has(tokens[0])) return { dc: tokens[0], used: 1 };
  for (const gen of GENITIVES_BY_LENGTH) {
    const words = gen.split(' ');
    if (words.length <= tokens.length
      && words.every((w, i) => tokens[i] === w)) {
      return { dc: CONSTELLATION_GENITIVES[gen], used: words.length };
    }
  }
  return null;
}

/** A trailing WDS-style component token (`A`, `B`, `Ca`, `Ab`). */
function isComponentToken(t: string): boolean {
  return /^[A-Z][a-c]?$/.test(t);
}

// GCVS one-letter designations run R–Z; A–Q single letters are Latin-upper
// Bayer. Two capitals and V-number forms are always GCVS.
function isGcvsToken(t: string): boolean {
  return /^[R-Z]$/.test(t) || /^[A-Z]{2}$/.test(t) || /^V\d{3,4}$/.test(t);
}

function isLatinBayerToken(t: string): boolean {
  return /^[a-z]\d{0,2}$/.test(t) || /^[A-Q]\d{0,2}$/.test(t);
}

/** Split `κ2` / `kap01` / `γ` into letter + superscript. Returns null when
 *  the token is not a Greek form under either convention. */
function splitGreekToken(
  token: string,
): { letter: string; sup: number | null } | null {
  const m = token.match(/^(\D+?)\.?(\d{1,2})?$/);
  if (!m) return null;
  const bare = m[1];
  const sup = m[2] !== undefined ? Number(m[2]) : null;
  if (GREEK_GLYPHS.has(bare)) return { letter: bare, sup };
  const glyph = ASCII_GREEK[bare.toLowerCase()];
  return glyph !== undefined ? { letter: glyph, sup } : null;
}

const NON_STELLAR_RE = /^(NGC|IC|NAME|Cl\*?|\[SC\d+\]|C)\s/;
const M_OBJECT_RE = /^M\s?\d+$/;
const OTHER_CATALOGUE_RE = /^(BD\s?[+-]|CD-|Gliese\s|GJ\s|Groombridge\s|WASP-|HAT-P-|ASAS\s|FAUST\s|\d+\s+H\.\s)/;

/** Normalise one NEC / wgsnFaints `Bayer/other` cell. Mechanical — every
 *  rule here is a measured population (docs/star-naming.md § 4), and the
 *  build pins the per-class counts. */
export function normaliseWgsnCell(raw: string | null): NormalisedCell {
  if (raw === null) return { class: 'empty' };
  let cell = foldCurlyGreek(raw.trim()).replace(/\[\d+\]$/, '');
  if (cell.startsWith('If[')) return { class: 'corrupt', raw };
  if (NON_STELLAR_RE.test(cell) || M_OBJECT_RE.test(cell)) {
    return { class: 'non_stellar', raw };
  }
  if (OTHER_CATALOGUE_RE.test(cell)) return { class: 'other_catalogue', raw };

  // `LO Hya (25 G. Hya)`: a variable form with the real designation in the
  // parenthetical. The GCVS tier already sources the outer form, so the
  // parenthetical is the cell's unique content.
  const paren = cell.match(/^(.+?)\s*\((.+)\)$/);
  if (paren !== null) {
    const inner = normaliseWgsnCell(paren[2]);
    if (normaliseWgsnCell(paren[1]).class === 'variable'
      && (inner.class === 'gould' || inner.class === 'flamsteed' || inner.class === 'bayer')) {
      return inner;
    }
  }

  // SIMBAD form: `* kap01 Scl B`, `* 65 Psc B`, `* i Cen`.
  if (cell.startsWith('* ')) cell = cell.slice(2);
  // V* prefix: SIMBAD variable-star ids (`V* QZ Car`).
  if (cell.startsWith('V* ')) cell = cell.slice(3);

  const tokens = cell.split(/\s+/);
  const head = tokens[0];

  // `<num> <con> [component]` (Flamsteed) and `<num> G. <con>` (Gould).
  if (/^\d+$/.test(head)) {
    const num = Number(head);
    const gould = tokens[1] === 'G.';
    const rest = tokens.slice(gould ? 2 : 1);
    const con = matchConstellation(rest);
    if (con === null) return { class: 'other_catalogue', raw };
    let tail = rest.slice(con.used);
    let serpensHalf: 'Cap' | 'Cau' | null = null;
    if (gould && con.dc === 'Ser' && (tail[0] === 'Cap' || tail[0] === 'Cau')) {
      serpensHalf = tail[0];
      tail = tail.slice(1);
    }
    const component = tail.length === 1 && isComponentToken(tail[0]) ? tail[0] : null;
    if (tail.length > (component !== null ? 1 : 0)) {
      return { class: 'other_catalogue', raw };
    }
    return gould
      ? { class: 'gould', gould: { num, dc: con.dc, component, serpensHalf } }
      : { class: 'flamsteed', flamsteed: { num, dc: con.dc, component } };
  }

  // Greek forms: `τ Phoenicis`, `γ 3 Octantis`, `κ2 Sculptoris`, `kap01 Scl A`.
  const greek = splitGreekToken(head);
  if (greek !== null || isLatinBayerToken(head) || isGcvsToken(head)) {
    let sup = greek?.sup ?? null;
    let rest = tokens.slice(1);
    if (sup === null && rest.length > 0 && /^\d$/.test(rest[0])) {
      sup = Number(rest[0]);
      rest = rest.slice(1);
    }
    const con = matchConstellation(rest);
    if (con === null) return { class: 'other_catalogue', raw };
    const tail = rest.slice(con.used);
    const component = tail.length === 1 && isComponentToken(tail[0]) ? tail[0] : null;
    if (tail.length > (component !== null ? 1 : 0)) {
      return { class: 'other_catalogue', raw };
    }
    // GCVS wins over Latin-upper Bayer only where the token IS a GCVS form;
    // a Greek match wins over both (`nu.` is Greek, never `NU`).
    if (greek !== null) {
      return {
        class: 'bayer',
        bayer: { letter: greek.letter, sup, dc: con.dc, component },
      };
    }
    if (isGcvsToken(head)) {
      return { class: 'variable', designation: `${head} ${con.dc}` };
    }
    const m = head.match(/^([A-Za-z])(\d{1,2})?$/);
    return {
      class: 'bayer',
      bayer: {
        letter: m![1],
        sup: m![2] !== undefined ? Number(m![2]) : sup,
        dc: con.dc,
        component,
      },
    };
  }

  return { class: 'other_catalogue', raw };
}

/** Normalise one IV/27A `bayer` cell against its own `cst` column:
 *  `alf` / `ksi` / `mu.01` / lowercase Latin / `A01`-style Latin-upper.
 *  GCVS-style cells (`R`, `RZ`, `V380` — 111 of them) are variable
 *  designations tier 6 already sources from GCVS, so they are rejected
 *  here rather than minted as Bayer letters. */
export function normaliseIv27aBayer(
  cell: string,
  cst: string,
): NormalisedCell {
  const trimmed = cell.trim();
  if (trimmed === '') return { class: 'empty' };
  if (isGcvsToken(trimmed.replace(/\d{2}$/, ''))
    || /^V\d{3,4}$/.test(trimmed)) {
    return { class: 'variable', designation: `${trimmed} ${cst}` };
  }
  const greek = splitGreekToken(trimmed);
  if (greek !== null) {
    return {
      class: 'bayer',
      bayer: { letter: greek.letter, sup: greek.sup, dc: cst, component: null },
    };
  }
  const m = trimmed.match(/^([a-zA-Z])(\d{2})?$/);
  if (m !== null && isLatinBayerToken(m[1] + (m[2] === undefined ? '' : String(Number(m[2]))))) {
    return {
      class: 'bayer',
      bayer: {
        letter: m[1],
        sup: m[2] !== undefined ? Number(m[2]) : null,
        dc: cst,
        component: null,
      },
    };
  }
  return { class: 'other_catalogue', raw: cell };
}

/** Split a multi-name cell into display name + published alternates:
 *  `Nganurganity / Unurgunite` → both; `Yunü (Yunu)` / `Bake-eo (or Bake
 *  Eo)` → parenthetical transliterations. Load-bearing, not cosmetic —
 *  three AT-HYG names are findable only after the split. */
export function splitNameCell(
  raw: string,
): { name: string; aliases: string[] } {
  let s = raw.trim();
  const aliases: string[] = [];
  const paren = s.match(/^(.*?)\s*\((?:or\s+)?(.+?)\)$/);
  if (paren !== null) {
    s = paren[1].trim();
    aliases.push(paren[2].trim());
  }
  const parts = s.split(/\s+\/\s+/);
  return { name: parts[0], aliases: [...parts.slice(1), ...aliases] };
}

/** Diacritic-folded, lowercased key for name matching — the § 2
 *  measurement's convention (`Yunü` finds `Yunu`). */
export function foldNameKey(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

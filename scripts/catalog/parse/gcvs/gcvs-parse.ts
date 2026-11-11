// GCVS variable-star catalogue parsing and per-Star cross-match.
// See README.md.
import {
  NO_CONSTELLATION_INDEX,
  VAR_TYPE_CEPHEID,
  VAR_TYPE_DSCT,
  VAR_TYPE_ECLIPSING,
  VAR_TYPE_MIRA,
  VAR_TYPE_OTHER,
  VAR_TYPE_PULSATING,
  VAR_TYPE_RR_LYRAE,
  VAR_TYPE_SEMIREGULAR,
  VAR_TYPE_UNKNOWN,
} from '../../../../src/catalog-format/record/catalog-pure';
import { CON_INDEX } from '../constellations/constellations';
import type { Star } from '../stars-parse';

export function splitPipeDelimited(text: string): string[][] {
  const out: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    out.push(line.split('|').map((f) => f.trim()));
  }
  return out;
}

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
  // GCVS type component (split on the composite separators + / |), each
  // mapped to its refined subtype so the runtime can drive the per-type
  // radius/colour-swing table. Only the base family is listed; GCVS's
  // trailing subtype letters ("DCEP"→"DCEPS", "CW"→"CWA/CWB",
  // "RV"→"RVA/RVB", "L"→"LB/LC") are accepted by the tail gate below, so
  // the list never has to enumerate every subtype. Order matters: the
  // longer of two nested families comes first so it wins the `startsWith`
  // ("DCEP"/"BCEP" before "CEP"). "M" and "L" are LAST — a bare single
  // letter would otherwise shadow a longer family sharing that initial.
  //
  // Family → subtype rationale: DCEP/CEP/CW/WVIR are the classical +
  // Type-II Cepheid instability strip; BCEP (β Cep) is a short-period
  // low-amplitude p-mode pulsator, grouped with the DSCT-class low-amp
  // set (DSCT/GDOR/SXPHE/ROAP/SPB/PVTEL/ACYG/ZZ). SR + L are red-giant /
  // supergiant semiregulars; M is the Mira archetype. RV (RV Tauri,
  // ambiguous post-AGB) falls to the generic pulsating default.
  const pulsatorPrefixes: [string, number][] = [
    ['DCEP', VAR_TYPE_CEPHEID], ['BCEP', VAR_TYPE_DSCT], ['CEP', VAR_TYPE_CEPHEID],
    ['DSCT', VAR_TYPE_DSCT], ['GDOR', VAR_TYPE_DSCT], ['SXPHE', VAR_TYPE_DSCT],
    ['PVTEL', VAR_TYPE_DSCT], ['ACYG', VAR_TYPE_DSCT], ['ROAP', VAR_TYPE_DSCT],
    ['WVIR', VAR_TYPE_CEPHEID], ['CW', VAR_TYPE_CEPHEID],
    ['RR', VAR_TYPE_RR_LYRAE], ['RV', VAR_TYPE_PULSATING],
    ['SPB', VAR_TYPE_DSCT],
    ['SR', VAR_TYPE_SEMIREGULAR],
    ['ZZ', VAR_TYPE_DSCT],
    ['M', VAR_TYPE_MIRA], ['L', VAR_TYPE_SEMIREGULAR],
  ];
  for (const part of t.split(/[+/|]/)) {
    const p = part.trim();
    if (!p) continue;
    for (const [pre, subtype] of pulsatorPrefixes) {
      if (p.startsWith(pre)) {
        // The tail after the family prefix must be a GCVS subtype
        // continuation: trailing subtype letters, a digit, a paren, or
        // end-of-string. No non-pulsator GCVS code shares a pulsator
        // family's prefix, so a letter tail is always a subtype — never
        // a coincidental longer word. A non-matching tail falls through
        // to the next prefix.
        const tail = p.slice(pre.length);
        if (tail === '' || /^[A-Z0-9()/.]/.test(tail)) return subtype;
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

export interface VarStarData {
  periodDays: number;
  amplitudeMag: number;
  /** Encoded VAR_TYPE_* from `classifyGcvsVarType`. VAR_TYPE_ECLIPSING
   *  drives the runtime pulsation-suppress gate and chart-mode ring
   *  exclusion (eclipsers earn wings instead); otherwise informational
   *  for hover tooltips. */
  varType: number;
}

export interface VarStarXref {
  byHip: Map<number, string>;
  byHd: Map<number, string>;
  byGaia: Map<string, string>;
}

// gcvs5.txt column indices (pipe-delimited, ~22 fields).
const GCVS_MAIN_MIN_FIELDS = 12;
const GCVS_MAIN_COL_NAME = 1;
const GCVS_MAIN_COL_TYPE = 3;
const GCVS_MAIN_COL_MAX_MAG = 4;
const GCVS_MAIN_COL_MIN_MAG = 5;
const GCVS_MAIN_COL_PERIOD = 10;

// crossid.txt column indices (pipe-delimited).
const GCVS_CROSSID_COL_LEFT = 0;   // "<CATALOG> <NUM>"
const GCVS_CROSSID_COL_RIGHT = 1;  // "= <GCVS_NAME>"

export function parseGcvsMain(text: string): Map<string, VarStarData> {
  const out = new Map<string, VarStarData>();
  for (const fields of splitPipeDelimited(text)) {
    if (fields.length < GCVS_MAIN_MIN_FIELDS) continue;
    const name = normalizeGcvsName(fields[GCVS_MAIN_COL_NAME] ?? '');
    if (!name) continue;
    // A bare transiting-planet host is neither an intrinsic variable nor
    // a stellar multiple — drop it so it renders as an ordinary star.
    if (isPlanetaryTransitOnly(fields[GCVS_MAIN_COL_TYPE])) continue;
    const minMagRaw = (fields[GCVS_MAIN_COL_MIN_MAG] ?? '').trim();
    const maxMag = parseGcvsNumber(fields[GCVS_MAIN_COL_MAX_MAG] ?? '');
    const minMag = parseGcvsNumber(minMagRaw);
    const periodDays = parseGcvsNumber(fields[GCVS_MAIN_COL_PERIOD] ?? '');
    const varType = classifyGcvsVarType(fields[GCVS_MAIN_COL_TYPE]);
    if (periodDays === null || periodDays <= 0) continue;
    // A parenthesised min-mag cell is GCVS amplitude notation: the
    // bracketed value IS the full amplitude (minimum unknown), not a
    // minimum magnitude — subtracting max would go negative and drop
    // the row (β Cen: 0.045 − 0.61).
    const amp = minMagRaw.startsWith('(')
      ? minMag
      : maxMag !== null && minMag !== null
        ? minMag - maxMag // min is dimmer (higher number) than max
        : null;
    if (amp === null || amp <= 0) continue;
    out.set(name, { periodDays, amplitudeMag: amp, varType });
  }
  return out;
}

export function parseGcvsCrossref(text: string): VarStarXref {
  const byHip = new Map<number, string>();
  const byHd = new Map<number, string>();
  for (const fields of splitPipeDelimited(text)) {
    // Each line: "<CATALOG> <NUM>          | = <GCVS_NAME>  | | |"
    // We only care about Hip and HD since those are what AT-HYG carries.
    const leftRaw = fields[GCVS_CROSSID_COL_LEFT] ?? '';
    const rightRaw = fields[GCVS_CROSSID_COL_RIGHT] ?? '';
    if (!leftRaw || !rightRaw) continue;

    // Left side examples: "Hip  000008", "HD   000015"
    const leftMatch = leftRaw.match(/^(\w+)\s+(\d+)/);
    if (!leftMatch) continue;
    const prefix = leftMatch[1].toLowerCase();
    if (prefix !== 'hip' && prefix !== 'hd') continue;
    const num = parseInt(leftMatch[2], 10);
    if (!Number.isFinite(num) || num <= 0) continue;

    // Right side: "=<GCVS_NAME>", strip the leading "=" and normalize.
    const rightMatch = rightRaw.match(/^=\s*(.+?)\s*$/);
    if (!rightMatch) continue;
    const gcvsName = normalizeGcvsName(rightMatch[1]);
    if (!gcvsName) continue;

    if (prefix === 'hip') byHip.set(num, gcvsName);
    else byHd.set(num, gcvsName);
  }
  return { byHip, byHd, byGaia: new Map() };
}

// Bridge the HIP-keyed half of the crossref onto gaia_source_id via the
// canonical Gaia DR3 ↔ HIP cross-walk. Mutates xref.byGaia in place.
//
// Two HIPs can resolve to the same gaia_source_id (Gaia fit only the
// primary of a close visual pair, so the secondary's HIP cross-walks to
// the primary's source). Resolution is lowest-HIP-wins — deterministic
// across refreshes rather than crossid.txt insertion order — and each
// collision is logged so a future gaia_dr3_hip_xmatch refresh surfaces
// as a warning, not a silent overwrite.
export function bridgeGcvsByGaia(
  xref: VarStarXref,
  hipToGaia: Map<number, string>,
): void {
  xref.byGaia.clear();
  const hipsByGaia = new Map<string, number[]>();
  for (const [hip] of xref.byHip) {
    const gaia = hipToGaia.get(hip);
    if (!gaia) continue;
    const hips = hipsByGaia.get(gaia);
    if (hips) hips.push(hip);
    else hipsByGaia.set(gaia, [hip]);
  }
  for (const [gaia, hips] of hipsByGaia) {
    hips.sort((a, b) => a - b);
    if (hips.length > 1) {
      console.warn(
        `GCVS bridge: gaia_source_id ${gaia} reached from HIPs [${hips.join(', ')}] — keeping first.`,
      );
    }
    xref.byGaia.set(gaia, xref.byHip.get(hips[0])!);
  }
}

/** The constellation a GCVS designation is named for, read off the designation
 *  itself: "LT Vul" is named for Vulpecula whatever any catalogue's editorial
 *  column says. `NO_CONSTELLATION_INDEX` for the designations that carry no
 *  constellation at all — NSV numbers, `LMC V0471` — which is why the caller
 *  treats it as "no opinion" rather than "no constellation". */
export function gcvsDesignationConIndex(gcvsName: string): number {
  const suffix = gcvsName.trim().split(/\s+/).pop() ?? '';
  return CON_INDEX.get(suffix.toLowerCase()) ?? NO_CONSTELLATION_INDEX;
}

/** The gcvs stage's count block. */
export type GcvsCounts = {
  /** Entries in the GCVS main table at source. */
  gcvsEntries: number;
  /** GCVS cross-reference Hipparcos lookups. */
  gcvsHipXrefs: number;
  /** GCVS cross-reference Henry Draper lookups. */
  gcvsHdXrefs: number;
  /** GCVS xrefs bridged from byHip via gaia_dr3_hip_xmatch.tsv onto
   *  gaia_source_id as primary key. */
  gcvsGaiaXrefs: number;
  /** Variables matched into the catalog with a renderable period, by the
   *  cross-reference that resolved them. */
  gcvsMatched: number;
  gcvsMatchedByGaia: number;
  gcvsMatchedByHip: number;
  gcvsMatchedByHd: number;
  /** Stars that resolved a GCVS designation (attached as `gcvsName` for
   *  search), a superset of `gcvsMatched`: a variable with no renderable
   *  period (flare stars, RCB, irregular, novae — Proxima = V0645 Cen,
   *  R CrB, T Tau, V1500 Cyg) is searchable by name but has no pulsation. */
  gcvsNamed: number;
};

export function gcvsSummary(c: GcvsCounts): string {
  return `${c.gcvsEntries} GCVS entries, ${c.gcvsHipXrefs} Hip + ${c.gcvsHdXrefs} HD + ${c.gcvsGaiaXrefs} Gaia xrefs, `
    + `${c.gcvsNamed} named for search (${c.gcvsMatched} with a renderable period: `
    + `gaia=${c.gcvsMatchedByGaia}, hip=${c.gcvsMatchedByHip}, hd=${c.gcvsMatchedByHd})`;
}

// Cross-match each star against GCVS via gaia_source_id (first; bridged
// from the HIP↔Gaia DR3 cross-walk), HIP (second), or HD (third). The
// gaia-first priority lets AT-HYG rows that carry a gaia_source_id
// but have an empty HIP cell still resolve through xref.byGaia, where
// the HIP-only path would miss them.
//
// The resolved designation is attached as `gcvsName` (search) whenever a
// name resolves; period / amplitude / varType (rendering) apply only when
// the GCVS main table also gave that name a period — the two gates are
// independent, so aperiodic variables stay findable by name.
export function applyVariability(
  stars: Star[],
  gcvsData: Map<string, VarStarData>,
  xref: VarStarXref,
): GcvsCounts {
  let matchedByGaia = 0;
  let matchedByHip = 0;
  let matchedByHd = 0;
  let named = 0;
  for (const s of stars) {
    let gcvsName: string | undefined;
    let source: 'gaia' | 'hip' | 'hd' | null = null;
    if (s.gaiaSourceId !== null) {
      gcvsName = xref.byGaia.get(s.gaiaSourceId);
      if (gcvsName) source = 'gaia';
    }
    if (!gcvsName && s.hip !== null) {
      gcvsName = xref.byHip.get(s.hip);
      if (gcvsName) source = 'hip';
    }
    if (!gcvsName && s.hd !== null) {
      gcvsName = xref.byHd.get(s.hd);
      if (gcvsName) source = 'hd';
    }
    if (!gcvsName || !source) continue;
    s.gcvsName = gcvsName;
    named++;
    // A GCVS designation names its own constellation (LT Vul is Vulpecula's
    // whatever any catalogue column says), but it fills `desigCon` only
    // where IV/27A left it empty. On the 8 records where the two disagree the
    // star carries BOTH a Bayer/Flamsteed designation and a variable name, in
    // different constellations (TY Crv is Crater's 'N Crt'), and one uint8
    // cannot serve both: IV/27A wins because its consumers BUILD the label
    // from this field, while a GCVS label reads the constellation out of the
    // designation string itself and only loses its expanded alias.
    const desigCon = gcvsDesignationConIndex(gcvsName);
    if (desigCon !== NO_CONSTELLATION_INDEX
        && s.desigCon.via === 'none') {
      s.desigCon = { via: 'gcvs', index: desigCon };
    }
    const data = gcvsData.get(gcvsName);
    if (!data) continue;
    s.periodDays = data.periodDays;
    s.amplitudeMag = data.amplitudeMag;
    s.varType = data.varType ?? VAR_TYPE_UNKNOWN;
    if (source === 'gaia') matchedByGaia++;
    else if (source === 'hip') matchedByHip++;
    else matchedByHd++;
  }
  return {
    gcvsEntries: gcvsData.size,
    gcvsHipXrefs: xref.byHip.size,
    gcvsHdXrefs: xref.byHd.size,
    gcvsGaiaXrefs: xref.byGaia.size,
    gcvsMatched: matchedByGaia + matchedByHip + matchedByHd,
    gcvsMatchedByGaia: matchedByGaia,
    gcvsMatchedByHip: matchedByHip,
    gcvsMatchedByHd: matchedByHd,
    gcvsNamed: named,
  };
}

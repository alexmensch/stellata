// GCVS variable-star catalogue parsing and per-Star cross-match.
// See README.md.
import { readFileSync } from 'node:fs';

import {
  classifyGcvsVarType,
  isPlanetaryTransitOnly,
  normalizeGcvsName,
  NO_CONSTELLATION_INDEX,
  parseGcvsNumber,
  splitPipeDelimited,
  VAR_TYPE_UNKNOWN,
} from '../../catalog-pure';
import { CON_INDEX } from '../constellations';
import type { Star } from '../stars-parse';

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

// Both GCVS files (gcvs5.txt and crossid.txt) are pipe-delimited with
// trailing whitespace inside each cell. Callers are expected to gate on
// file existence before calling.
function readPipeDelimited(path: string): string[][] {
  return splitPipeDelimited(readFileSync(path, 'utf8'));
}

export function parseGcvsMain(srcPath: string): Map<string, VarStarData> {
  const out = new Map<string, VarStarData>();
  for (const fields of readPipeDelimited(srcPath)) {
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

export function parseGcvsCrossref(srcPath: string): VarStarXref {
  const byHip = new Map<number, string>();
  const byHd = new Map<number, string>();
  for (const fields of readPipeDelimited(srcPath)) {
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

export interface ApplyVariabilityResult {
  matched: number;
  matchedByGaia: number;
  matchedByHip: number;
  matchedByHd: number;
  /** Stars that resolved a GCVS designation (attached as `gcvsName` for
   *  search), a superset of `matched`: a variable with no renderable
   *  period (flare stars, RCB, irregular, novae — Proxima = V0645 Cen,
   *  R CrB, T Tau, V1500 Cyg) is searchable by name but has no pulsation. */
  named: number;
  /** Stars whose `desigConIndex` came from their GCVS designation. No pass
   *  upstream sets the field today, so this is currently every named star
   *  whose designation carries a constellation abbreviation — but the
   *  disagreement check below stays: it is what keeps the designation
   *  outranking any editorial index a later pass reinstates. */
  desigConSupplied: number;
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
): ApplyVariabilityResult {
  let matchedByGaia = 0;
  let matchedByHip = 0;
  let matchedByHd = 0;
  let named = 0;
  let desigConSupplied = 0;
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
    // A GCVS designation names its own constellation, which is what makes it
    // the designation authority: it is right where an editorial cell was
    // stale (LT Vul, filed under Sge) and where one missed the mover outright
    // (RY Cen, EQ Vul).
    const desigCon = gcvsDesignationConIndex(gcvsName);
    if (desigCon !== NO_CONSTELLATION_INDEX && desigCon !== s.desigConIndex) {
      s.desigConIndex = desigCon;
      desigConSupplied++;
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
    matched: matchedByGaia + matchedByHip + matchedByHd,
    matchedByGaia,
    matchedByHip,
    matchedByHd,
    named,
    desigConSupplied,
  };
}

// GCVS variable-star catalogue parsing and per-Star cross-match. See
// scripts/catalog/README.md § GCVS variability cross-match.
import { readFileSync } from 'node:fs';

import {
  classifyGcvsVarType,
  normalizeGcvsName,
  parseGcvsNumber,
  VAR_TYPE_UNKNOWN,
} from './catalog-pure';
import type { Star } from './stars-parse';

export interface VarStarData {
  periodDays: number;
  amplitudeMag: number;
  /** Encoded VAR_TYPE_* from `classifyGcvsVarType`. Drives the runtime
   *  pulsation-suppression gate on eclipsing binaries with orbital
   *  elements; otherwise informational for hover tooltips. */
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
// trailing whitespace inside each cell. Yields per-line trimmed-field
// arrays. Callers are expected to gate on file existence before calling.
function* readPipeDelimited(path: string): Iterable<string[]> {
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    yield line.split('|').map((f) => f.trim());
  }
}

export function parseGcvsMain(srcPath: string): Map<string, VarStarData> {
  const out = new Map<string, VarStarData>();
  for (const fields of readPipeDelimited(srcPath)) {
    if (fields.length < GCVS_MAIN_MIN_FIELDS) continue;
    const name = normalizeGcvsName(fields[GCVS_MAIN_COL_NAME] ?? '');
    if (!name) continue;
    const maxMag = parseGcvsNumber(fields[GCVS_MAIN_COL_MAX_MAG] ?? '');
    const minMag = parseGcvsNumber(fields[GCVS_MAIN_COL_MIN_MAG] ?? '');
    const periodDays = parseGcvsNumber(fields[GCVS_MAIN_COL_PERIOD] ?? '');
    const varType = classifyGcvsVarType(fields[GCVS_MAIN_COL_TYPE]);
    if (periodDays === null || periodDays <= 0) continue;
    if (maxMag === null || minMag === null) continue;
    const amp = minMag - maxMag; // min is dimmer (higher number) than max
    if (amp <= 0) continue;
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
// Returns the bridged byGaia map (size = how many HIP xrefs found a
// gaia_source_id in the walk).
export function bridgeGcvsByGaia(
  xref: VarStarXref,
  hipToGaia: Map<number, string>,
): Map<string, string> {
  xref.byGaia.clear();
  for (const [hip, gcvsName] of xref.byHip) {
    const gaia = hipToGaia.get(hip);
    if (!gaia) continue;
    xref.byGaia.set(gaia, gcvsName);
  }
  return xref.byGaia;
}

export interface ApplyVariabilityResult {
  matched: number;
  matchedByGaia: number;
  matchedByHip: number;
  matchedByHd: number;
}

// Cross-match each star against GCVS via gaia_source_id (first; bridged
// from the HIP↔Gaia DR3 cross-walk), HIP (second), or HD (third). The
// gaia-first priority lets AT-HYG rows that carry a gaia_source_id
// but have an empty HIP cell still resolve through xref.byGaia, where
// the HIP-only path would miss them.
export function applyVariability(
  stars: Star[],
  gcvsData: Map<string, VarStarData>,
  xref: VarStarXref,
): ApplyVariabilityResult {
  let matchedByGaia = 0;
  let matchedByHip = 0;
  let matchedByHd = 0;
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
  };
}

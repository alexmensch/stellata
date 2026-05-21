// GCVS variable-star catalogue parsing. Reads gcvs5.txt (main
// catalogue: period, max/min mags, variability type keyed by
// designation like "R And") and crossid.txt (Hip/HD/Tyc/SAO/etc. →
// GCVS designation). applyVariability then cross-matches every Star
// via HIP first, HD fallback. Both source files are pipe-delimited
// with trailing whitespace inside cells; readPipeDelimited normalises
// that. Stars without a period (irregular variables, SN) stay at 0/0
// and don't pulse in the renderer.
import { readFileSync } from 'node:fs';

import { normalizeGcvsName, parseGcvsNumber } from './catalog-pure';
import type { Star } from './stars-parse';

export interface VarStarData {
  periodDays: number;
  amplitudeMag: number;
}

export interface VarStarXref {
  byHip: Map<number, string>;
  byHd: Map<number, string>;
}

// gcvs5.txt column indices (pipe-delimited, ~22 fields).
const GCVS_MAIN_MIN_FIELDS = 12;
const GCVS_MAIN_COL_NAME = 1;
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
    if (periodDays === null || periodDays <= 0) continue;
    if (maxMag === null || minMag === null) continue;
    const amp = minMag - maxMag; // min is dimmer (higher number) than max
    if (amp <= 0) continue;
    out.set(name, { periodDays, amplitudeMag: amp });
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
  return { byHip, byHd };
}

// Cross-match each star against GCVS via HIP (first) or HD (fallback). Most
// AT-HYG stars with a Hipparcos or HD designation that appears in GCVS will
// get period + amplitude here; stars without either ID, or whose cross-ref
// GCVS entry lacks a period (irregular variables, SN, etc.), stay at 0/0
// and won't pulse.
export function applyVariability(
  stars: Star[],
  gcvsData: Map<string, VarStarData>,
  xref: VarStarXref,
): { matched: number } {
  let matched = 0;
  for (const s of stars) {
    let gcvsName: string | undefined;
    if (s.hip !== null) gcvsName = xref.byHip.get(s.hip);
    if (!gcvsName && s.hd !== null) gcvsName = xref.byHd.get(s.hd);
    if (!gcvsName) continue;
    const data = gcvsData.get(gcvsName);
    if (!data) continue;
    s.periodDays = data.periodDays;
    s.amplitudeMag = data.amplitudeMag;
    matched++;
  }
  return { matched };
}

// Loads the frozen primary tables AT-HYG merged, for the primaries audit and
// the membership manifest build. See README.md § The primaries audit.

import { resolve } from 'node:path';

import { REPO_ROOT as ROOT, readRequired } from '../../util/paths';
import { dataRows, parseIntOrNull } from '../parse/corpus-tsv';
import { readGaiaHipXmatch, readGaiaTycXmatch } from '../parse/gaia-xmatch';
import {
  SRC_CNS5, SRC_HIP_XMATCH, SRC_TYC2_HD, SRC_TYC_XMATCH,
} from '../classic-ids/binding-candidates';
import {
  parseBsc5Tsv, parseCns5Tsv, parseCrossIndexTsv, parseTyc2HdTsv,
} from '../classic-ids/classic-ids-parse';
import { parseGlieseTsv } from '../gliese-parse';
import { parseTycho2Tsvs } from '../tycho2-parse';
import { addKeyed, type PrimaryTables, type SimbadXids, type WgsnKeys } from './primaries-audit-pure';

export const SRC_BSC5 = resolve(ROOT, 'data/classic-ids/bsc5.tsv');
export const SRC_CROSS_INDEX = resolve(ROOT, 'data/classic-ids/cross_index.tsv');
export const SRC_GLIESE = resolve(ROOT, 'data/gliese/gliese_v70a.tsv');
export const SRC_HIP_MAIN = resolve(ROOT, 'data/hipparcos/hip_main_vmag.tsv');
export const SRC_HIP2 = resolve(ROOT, 'data/hipparcos/hip2_van_leeuwen.tsv');
export const SRC_TYCHO2_MAIN = resolve(ROOT, 'data/tycho2/tycho2_main.tsv');
export const SRC_TYCHO2_SUPPL1 = resolve(ROOT, 'data/tycho2/tycho2_suppl1.tsv');
export const SRC_WGSN_NAMES = resolve(ROOT, 'data/iau-wgsn/wgsn_names.tsv');
export const SRC_WGSN_DESIGNATIONS = resolve(ROOT, 'data/iau-wgsn/wgsn_designations.tsv');
export const SRC_SIMBAD_SPTYPE = resolve(ROOT, 'data/simbad/simbad_sptype.tsv');

export const LFS_HINT = 'run `git lfs pull`.';
const HIP_VMAG_HINT = 'run `pnpm run refresh:hip-vmag`.';
const WGSN_HINT = 'run `pnpm run build:wgsn`.';

function readHipColumn(path: string, hint: string, label: string): Set<number> {
  const into = new Set<number>();
  for (const { cells, idx } of dataRows(readRequired(path, hint), ['hip'], label, hint)) {
    const hip = parseIntOrNull(cells[idx.hip]);
    if (hip !== null) into.add(hip);
  }
  return into;
}

function readWgsn(): WgsnKeys {
  const names = new Set<string>();
  const hd = new Set<number>();
  const hip = new Set<number>();
  const flamByHd = new Map<number, Set<number>>();
  const flamByHip = new Map<number, Set<number>>();
  for (const { cells, idx } of dataRows(
    readRequired(SRC_WGSN_NAMES, WGSN_HINT), ['name', 'aliases', 'hip', 'hd'],
    'wgsn_names.tsv', WGSN_HINT,
  )) {
    if (cells[idx.name]) names.add(cells[idx.name]);
    for (const alias of (cells[idx.aliases] ?? '').split('|')) if (alias) names.add(alias);
    const h = parseIntOrNull(cells[idx.hip]);
    const d = parseIntOrNull(cells[idx.hd]);
    if (h !== null) hip.add(h);
    if (d !== null) hd.add(d);
  }
  for (const { cells, idx } of dataRows(
    readRequired(SRC_WGSN_DESIGNATIONS, WGSN_HINT), ['kind', 'num', 'hip', 'hd'],
    'wgsn_designations.tsv', WGSN_HINT,
  )) {
    const h = parseIntOrNull(cells[idx.hip]);
    const d = parseIntOrNull(cells[idx.hd]);
    if (h !== null) hip.add(h);
    if (d !== null) hd.add(d);
    if (cells[idx.kind] !== 'flamsteed') continue;
    const num = parseIntOrNull(cells[idx.num]);
    if (num === null) continue;
    if (d !== null) addKeyed(flamByHd, d, num);
    if (h !== null) addKeyed(flamByHip, h, num);
  }
  return { names, hd, hip, flamByHd, flamByHip };
}

function readSimbadXids(): Map<string, SimbadXids> {
  const out = new Map<string, SimbadXids>();
  for (const { cells, idx } of dataRows(
    readRequired(SRC_SIMBAD_SPTYPE, LFS_HINT), ['source_id', 'hip', 'tyc', 'gj'],
    'simbad_sptype.tsv', LFS_HINT,
  )) {
    const sourceId = cells[idx.source_id];
    if (!sourceId) continue;
    // Two rows under one id would make the corroboration verdict depend on file
    // order; the values parser refuses the same shape (README.md § Six source_ids).
    if (out.has(sourceId)) {
      throw new Error(`simbad_sptype.tsv: duplicate source_id ${sourceId}; ${LFS_HINT}`);
    }
    out.set(sourceId, {
      hip: parseIntOrNull(cells[idx.hip]),
      tyc: cells[idx.tyc] || null,
      gj: cells[idx.gj] || null,
    });
  }
  return out;
}

/** `keepTycs` narrows the 2.5 M-row TYC cross-walk to the Tycho ids the caller
 *  will look up — IV/25's plus the spine's. */
export async function loadPrimaryTables(keepTycs: Iterable<string>): Promise<PrimaryTables> {
  const iv25 = parseTyc2HdTsv(readRequired(SRC_TYC2_HD, LFS_HINT));
  const keep = new Set<string>(iv25.map((r) => r.tyc));
  for (const tyc of keepTycs) keep.add(tyc);
  return {
    iv25,
    v50: parseBsc5Tsv(readRequired(SRC_BSC5, LFS_HINT)),
    iv27a: parseCrossIndexTsv(readRequired(SRC_CROSS_INDEX, LFS_HINT)),
    cns5: parseCns5Tsv(readRequired(SRC_CNS5, LFS_HINT)),
    gliese: parseGlieseTsv(readRequired(SRC_GLIESE, LFS_HINT)),
    hipI239: readHipColumn(SRC_HIP_MAIN, HIP_VMAG_HINT, 'hip_main_vmag.tsv'),
    hip2: readHipColumn(SRC_HIP2, LFS_HINT, 'hip2_van_leeuwen.tsv'),
    wgsn: readWgsn(),
    tycho2: parseTycho2Tsvs(
      readRequired(SRC_TYCHO2_MAIN, LFS_HINT), readRequired(SRC_TYCHO2_SUPPL1, LFS_HINT),
    ),
    tycToSource: await readGaiaTycXmatch(SRC_TYC_XMATCH, keep),
    hipToSource: readGaiaHipXmatch(SRC_HIP_XMATCH),
    simbadBySourceId: readSimbadXids(),
  };
}

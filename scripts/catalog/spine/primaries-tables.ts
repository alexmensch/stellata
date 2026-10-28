// Loads the frozen primary tables AT-HYG merged, for the primaries audit and
// the membership manifest build. See README.md#the-primaries-audit.

import { resolve } from 'node:path';

import { REPO_ROOT as ROOT, readRequired } from '../../util/paths';
import { WGSN_DESIGNATIONS } from '../naming/wgsn-designations-tsv';
import { WGSN_NAMES } from '../naming/wgsn-names-tsv';
import { readTable, type TableSpec } from '../../util/tsv/table-pure';
import { readGaiaHipXmatch, readGaiaTycXmatch } from '../parse/gaia-xmatch';
import {
  SRC_CNS5, SRC_HIP_XMATCH, SRC_TYC2_HD, SRC_TYC_XMATCH,
} from '../classic-ids/binding-candidates';
import {
  parseBsc5Tsv, parseCns5Tsv, parseTyc2HdTsv,
} from '../classic-ids/classic-ids-parse';
import { readCrossIndexTable } from '../classic-ids/cross-index';
import { parseGlieseTsv } from '../gliese-parse';
import { parseTycho2Tsvs } from '../tycho2-parse';
import { loadStoredEdges } from '../../sid/registry-io';
import {
  addKeyed, glAliasesFromEdges,
  type BindingTables, type PrimaryTables, type SimbadXids, type WgsnKeys,
} from './primaries-audit-pure';

export const SRC_BSC5 = resolve(ROOT, 'data/classic-ids/bsc5.tsv');
export const SRC_GLIESE = resolve(ROOT, 'data/gliese/gliese_v70a.tsv');
export const SRC_HIP_MAIN = resolve(ROOT, 'data/hipparcos/hip_main_vmag.tsv');
export const SRC_HIP2 = resolve(ROOT, 'data/hipparcos/hip2_van_leeuwen.tsv');
export const SRC_TYCHO2_MAIN = resolve(ROOT, 'data/tycho2/tycho2_main.tsv');
export const SRC_TYCHO2_SUPPL1 = resolve(ROOT, 'data/tycho2/tycho2_suppl1.tsv');
export const SRC_SIMBAD_SPTYPE = resolve(ROOT, 'data/simbad/simbad_sptype.tsv');

export const LFS_HINT = 'run `git lfs pull`.';
const HIP_VMAG_HINT = 'Re-run `pnpm run refresh:hip-vmag`.';
const WGSN_HINT = 'run `pnpm run build:wgsn`.';

const HIP_MAIN = {
  file: 'data/hipparcos/hip_main_vmag.tsv',
  columns: ['hip', 'hd'] as const,
  hint: HIP_VMAG_HINT,
} satisfies TableSpec<string>;

const HIP2_HIPS = {
  file: 'data/hipparcos/hip2_van_leeuwen.tsv',
  columns: ['hip'] as const,
  hint: 'Re-run `pnpm run refresh:hip2`.',
} satisfies TableSpec<string>;

const SIMBAD_SPTYPE_XIDS = {
  file: 'data/simbad/simbad_sptype.tsv',
  columns: ['source_id', 'hip', 'tyc', 'gj'] as const,
  hint: 'Re-run scripts/refresh/refresh-simbad-sptype.py.',
} satisfies TableSpec<string>;

function readHip2Hips(): Set<number> {
  const into = new Set<number>();
  for (const row of readTable(HIP2_HIPS, readRequired(SRC_HIP2, LFS_HINT))) {
    const value = row.int('hip');
    if (value !== null) into.add(value);
  }
  return into;
}

/** I/239 in one pass: the two key sets, and the HIP → HD pairing that the
 *  association audit's HIP↔HD link reads. */
function readI239(): { hip: Set<number>; hd: Set<number>; hipHd: Map<number, number> } {
  const hip = new Set<number>();
  const hd = new Set<number>();
  const hipHd = new Map<number, number>();
  for (const row of readTable(HIP_MAIN, readRequired(SRC_HIP_MAIN, HIP_VMAG_HINT))) {
    const h = row.int('hip');
    const d = row.int('hd');
    if (h !== null) hip.add(h);
    if (d !== null) hd.add(d);
    if (h !== null && d !== null) hipHd.set(h, d);
  }
  return { hip, hd, hipHd };
}

function readWgsn(): WgsnKeys {
  const names = new Set<string>();
  const hd = new Set<number>();
  const hip = new Set<number>();
  const flamByHd = new Map<number, Set<number>>();
  const flamByHip = new Map<number, Set<number>>();
  for (const row of WGSN_NAMES.rows(readRequired(resolve(ROOT, WGSN_NAMES.file), WGSN_HINT))) {
    names.add(row.name);
    for (const alias of row.aliases) if (alias) names.add(alias);
    if (row.hip !== null) hip.add(row.hip);
    if (row.hd !== null) hd.add(row.hd);
  }
  for (const row of WGSN_DESIGNATIONS.rows(readRequired(resolve(ROOT, WGSN_DESIGNATIONS.file), WGSN_HINT))) {
    if (row.hip !== null) hip.add(row.hip);
    if (row.hd !== null) hd.add(row.hd);
    if (row.kind !== 'flamsteed' || row.num === null) continue;
    if (row.hd !== null) addKeyed(flamByHd, row.hd, row.num);
    if (row.hip !== null) addKeyed(flamByHip, row.hip, row.num);
  }
  return { names, hd, hip, flamByHd, flamByHip };
}

function readSimbadXids(): Map<string, SimbadXids> {
  const out = new Map<string, SimbadXids>();
  for (const row of readTable(SIMBAD_SPTYPE_XIDS, readRequired(SRC_SIMBAD_SPTYPE, LFS_HINT))) {
    const sourceId = row.raw('source_id');
    if (!sourceId) continue;
    // Two rows under one id would make the corroboration verdict depend on file
    // order; the values parser refuses the same shape (README.md#six-source_ids-dr3-does-not-publish).
    if (out.has(sourceId)) row.fail(`duplicate source_id ${sourceId}`);
    out.set(sourceId, {
      hip: row.int('hip'),
      tyc: row.raw('tyc') || null,
      gj: row.raw('gj') || null,
    });
  }
  return out;
}

/** The binding derivation's inputs alone. `keepTycs` narrows the 2.5 M-row TYC
 *  cross-walk to the Tycho ids the caller will look up. */
export async function loadBindingTables(keepTycs: ReadonlySet<string>): Promise<BindingTables> {
  return {
    cns5: parseCns5Tsv(readRequired(SRC_CNS5, LFS_HINT)),
    glAliases: glAliasesFromEdges(loadStoredEdges()),
    tycToSource: await readGaiaTycXmatch(SRC_TYC_XMATCH, keepTycs),
    hipToSource: readGaiaHipXmatch(SRC_HIP_XMATCH),
    simbadBySourceId: readSimbadXids(),
  };
}

export function loadTycho2(): ReturnType<typeof parseTycho2Tsvs> {
  return parseTycho2Tsvs(
    readRequired(SRC_TYCHO2_MAIN, LFS_HINT), readRequired(SRC_TYCHO2_SUPPL1, LFS_HINT),
  );
}

export function loadGliese(): ReturnType<typeof parseGlieseTsv> {
  return parseGlieseTsv(readRequired(SRC_GLIESE, LFS_HINT));
}

/** `keepTycs` narrows the 2.5 M-row TYC cross-walk to the Tycho ids the caller
 *  will look up — IV/25's plus the spine's. */
export async function loadPrimaryTables(keepTycs: Iterable<string>): Promise<PrimaryTables> {
  const iv25 = parseTyc2HdTsv(readRequired(SRC_TYC2_HD, LFS_HINT));
  const keep = new Set<string>(iv25.map((r) => r.tyc));
  for (const tyc of keepTycs) keep.add(tyc);
  const i239 = readI239();
  return {
    ...await loadBindingTables(keep),
    iv25,
    v50: parseBsc5Tsv(readRequired(SRC_BSC5, LFS_HINT)),
    iv27a: readCrossIndexTable(),
    gliese: loadGliese(),
    hipI239: i239.hip,
    hdI239: i239.hd,
    i239HipHd: i239.hipHd,
    hip2: readHip2Hips(),
    wgsn: readWgsn(),
    tycho2: loadTycho2(),
  };
}

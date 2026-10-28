// Loads the frozen primary tables AT-HYG merged, for the primaries audit and
// the membership manifest build. See README.md#the-primaries-audit.

import { resolve } from 'node:path';

import { REPO_ROOT as ROOT, readRequired } from '../../util/paths';
import { WGSN_DESIGNATIONS } from '../naming/wgsn-designations-tsv';
import { WGSN_NAMES } from '../naming/wgsn-names-tsv';
import { readTable, type TableSpec } from '../../util/tsv/table-pure';
import { GAIA_HIP_XMATCH } from '../parse/gaia-hip-xmatch-source';
import { GAIA_TYC_XMATCH } from '../parse/gaia-tyc-xmatch-source';
import { BSC5 } from '../classic-ids/bsc5-source';
import { TYC2_HD } from '../classic-ids/tyc2-hd-source';
import { CNS5 } from '../classic-ids/cns5-source';
import { CROSS_INDEX } from '../classic-ids/cross-index-source';
import { GLIESE } from '../gliese-source';
import { TYCHO2 } from '../tycho2-source';
import { loadStoredEdges } from '../../sid/registry-io';
import {
  addKeyed, glAliasesFromEdges,
  type BindingTables, type PrimaryTables, type SimbadXids, type WgsnKeys,
} from './primaries-audit-pure';

export const SRC_HIP_MAIN = resolve(ROOT, 'data/hipparcos/hip_main_vmag.tsv');
export const SRC_HIP2 = resolve(ROOT, 'data/hipparcos/hip2_van_leeuwen.tsv');
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
    const sourceId = row.sourceId('source_id');
    if (sourceId === null) continue;
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
    cns5: CNS5.read(),
    glAliases: glAliasesFromEdges(loadStoredEdges()),
    tycToSource: await GAIA_TYC_XMATCH.read(keepTycs),
    hipToSource: GAIA_HIP_XMATCH.read(),
    simbadBySourceId: readSimbadXids(),
  };
}

/** `keepTycs` narrows the 2.5 M-row TYC cross-walk to the Tycho ids the caller
 *  will look up — IV/25's plus the spine's. */
export async function loadPrimaryTables(keepTycs: Iterable<string>): Promise<PrimaryTables> {
  const iv25 = TYC2_HD.read();
  const keep = new Set<string>(iv25.map((r) => r.tyc));
  for (const tyc of keepTycs) keep.add(tyc);
  const i239 = readI239();
  return {
    ...await loadBindingTables(keep),
    iv25,
    v50: BSC5.read(),
    iv27a: CROSS_INDEX.read(),
    gliese: GLIESE.read(),
    hipI239: i239.hip,
    hdI239: i239.hd,
    i239HipHd: i239.hipHd,
    hip2: readHip2Hips(),
    wgsn: readWgsn(),
    tycho2: TYCHO2.read(),
  };
}

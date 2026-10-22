// Loaders for the tables the classic-ID overlay join reads.
// See README.md#the-gates-evidence-has-to-be-pulled.

import { resolve } from 'node:path';

import { readGaiaHipXmatch, readGaiaTycXmatch } from '../parse/gaia-xmatch';
import { parseBsc5Tsv, parseCns5Tsv, parseTyc2HdTsv } from './classic-ids-parse';
import { readCrossIndexTable } from './cross-index';
import type { OverlayWalks } from './classic-id-overlay-pure';
import { readRequired, requireExists, REPO_ROOT as ROOT } from '../../util/paths';

export const SRC_TYC2_HD = resolve(ROOT, 'data/classic-ids/tyc2_hd.tsv');
export const SRC_CNS5 = resolve(ROOT, 'data/classic-ids/cns5.tsv');
export const SRC_TYC_XMATCH = resolve(ROOT, 'data/gaia/gaia_dr3_tyc_xmatch.tsv');
export const SRC_HIP_XMATCH = resolve(ROOT, 'data/gaia/gaia_dr3_hip_xmatch.tsv');
const SRC_BSC5 = resolve(ROOT, 'data/classic-ids/bsc5.tsv');

const CDS_HINT = 'refresh the CDS inputs with `pnpm run refresh:classic-ids`.';
const XMATCH_HINT = 'refresh the cross-walk with `pnpm run refresh:gaia-hip` / `refresh:gaia-tyc`.';

/** Everything the overlay join reads. The TYC cross-walk is narrowed to the
 *  Tycho ids IV/25 mentions: the full table is 2.5 M rows for a ~350 k-row
 *  join. */
export async function loadClassicIdCrossWalks(): Promise<OverlayWalks> {
  requireExists(SRC_TYC_XMATCH, XMATCH_HINT);
  requireExists(SRC_HIP_XMATCH, XMATCH_HINT);
  const tyc2Hd = parseTyc2HdTsv(readRequired(SRC_TYC2_HD, CDS_HINT));
  return {
    tyc2Hd,
    crossIndex: readCrossIndexTable(),
    bsc5: parseBsc5Tsv(readRequired(SRC_BSC5, CDS_HINT)),
    cns5: parseCns5Tsv(readRequired(SRC_CNS5, CDS_HINT)),
    tycToSource: await readGaiaTycXmatch(SRC_TYC_XMATCH, new Set(tyc2Hd.map((r) => r.tyc))),
    hipToSource: readGaiaHipXmatch(SRC_HIP_XMATCH),
  };
}

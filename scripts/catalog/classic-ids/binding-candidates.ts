// Loaders for the tables the classic-ID overlay join reads.
// See README.md#the-gates-evidence-has-to-be-pulled.

import { resolve } from 'node:path';

import { GAIA_HIP_XMATCH } from '../parse/gaia-hip-xmatch-source';
import { GAIA_TYC_XMATCH } from '../parse/gaia-tyc-xmatch-source';
import { parseBsc5Tsv, parseTyc2HdTsv } from './classic-ids-parse';
import { CNS5 } from './cns5-source';
import { CROSS_INDEX } from './cross-index-source';
import type { OverlayWalks } from './classic-id-overlay-pure';
import { readRequired, REPO_ROOT as ROOT } from '../../util/paths';

export const SRC_TYC2_HD = resolve(ROOT, 'data/classic-ids/tyc2_hd.tsv');
const SRC_BSC5 = resolve(ROOT, 'data/classic-ids/bsc5.tsv');

const CDS_HINT = 'refresh the CDS inputs with `pnpm run refresh:classic-ids`.';

/** Everything the overlay join reads. The TYC cross-walk is narrowed to the
 *  Tycho ids IV/25 mentions: the full table is 2.5 M rows for a ~350 k-row
 *  join. */
export async function loadClassicIdCrossWalks(): Promise<OverlayWalks> {
  const tyc2Hd = parseTyc2HdTsv(readRequired(SRC_TYC2_HD, CDS_HINT));
  return {
    tyc2Hd,
    crossIndex: CROSS_INDEX.read(),
    bsc5: parseBsc5Tsv(readRequired(SRC_BSC5, CDS_HINT)),
    cns5: CNS5.read(),
    tycToSource: await GAIA_TYC_XMATCH.read(new Set(tyc2Hd.map((r) => r.tyc))),
    hipToSource: GAIA_HIP_XMATCH.read(),
  };
}

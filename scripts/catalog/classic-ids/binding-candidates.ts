// Loaders for the tables the classic-ID overlay join reads.
// See README.md#the-gates-evidence-has-to-be-pulled.

import { GAIA_HIP_XMATCH } from '../parse/gaia-hip-xmatch-source';
import { GAIA_TYC_XMATCH } from '../parse/gaia-tyc-xmatch-source';
import { BSC5 } from './bsc5-source';
import { CNS5 } from './cns5-source';
import { CROSS_INDEX } from './cross-index-source';
import { TYC2_HD } from './tyc2-hd-source';
import type { OverlayWalks } from './classic-id-overlay-pure';

/** Everything the overlay join reads. The TYC cross-walk is narrowed to the
 *  Tycho ids IV/25 mentions: the full table is 2.5 M rows for a ~350 k-row
 *  join. */
export async function loadClassicIdCrossWalks(): Promise<OverlayWalks> {
  const tyc2Hd = TYC2_HD.read();
  return {
    tyc2Hd,
    crossIndex: CROSS_INDEX.read(),
    bsc5: BSC5.read(),
    cns5: CNS5.read(),
    tycToSource: await GAIA_TYC_XMATCH.read(new Set(tyc2Hd.map((r) => r.tyc))),
    hipToSource: GAIA_HIP_XMATCH.read(),
  };
}

// The three whole-table Gaia DR3 pulls as Pull values, one per step. See README.md.

import type { Pull } from '../pull/pull';
import { GAIA } from '../pull/tap-pure';
import { GAIA_HIP_XMATCH_OUTPUTS, GAIA_NSS_OUTPUTS, GAIA_TYC_XMATCH_OUTPUTS } from './gaia-whole-table-outputs';
import { HIP_XMATCH, NSS_TWO_BODY, TYC_XMATCH } from './gaia-whole-table-pure';

const RELEASE = 'Gaia DR3';

export const HIP_XMATCH_PULL: Pull<'xmatch'> = { archive: GAIA, outputs: GAIA_HIP_XMATCH_OUTPUTS, release: RELEASE, tables: { xmatch: HIP_XMATCH } };
export const TYC_XMATCH_PULL: Pull<'xmatch'> = { archive: GAIA, outputs: GAIA_TYC_XMATCH_OUTPUTS, release: RELEASE, tables: { xmatch: TYC_XMATCH } };
export const NSS_PULL: Pull<'nss'> = { archive: GAIA, outputs: GAIA_NSS_OUTPUTS, release: RELEASE, tables: { nss: NSS_TWO_BODY } };

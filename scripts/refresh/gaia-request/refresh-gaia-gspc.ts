// refresh:gaia-gspc — Gaia DR3 GSPC Johnson B and V for the full-catalogue request. See README.md.

import type { PullDescription } from '../../util/emit-artifacts';
import { describePull, runPull, type Pull } from '../pull/pull';
import { GAIA, GAIA_DR3_RELEASE } from '../pull/tap-pure';
import { CATALOG_ASTROMETRY_REQUEST } from './catalog-astrometry-request-source';
import { GAIA_GSPC_OUTPUTS } from './gaia-request-outputs';
import { gspcTable } from './gaia-request-pure';

const pull = (): Pull<'gspc'> => ({
  archive: GAIA, outputs: GAIA_GSPC_OUTPUTS, release: GAIA_DR3_RELEASE, tables: { gspc: gspcTable(CATALOG_ASTROMETRY_REQUEST.read()) },
});

export const describe = (): PullDescription => describePull(pull());
export const main = (): Promise<void> => runPull(pull());

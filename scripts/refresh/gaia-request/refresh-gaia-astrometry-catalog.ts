// refresh:gaia-astrometry-catalog — Gaia DR3 astrometry for the one astrometry request. See README.md.

import type { PullDescription } from '../../util/emit-artifacts';
import { describePull, runPull, type Pull } from '../pull/pull';
import { GAIA, GAIA_DR3_RELEASE } from '../pull/tap-pure';
import { CATALOG_ASTROMETRY_REQUEST } from './catalog-astrometry-request-source';
import { GAIA_ASTROMETRY_CATALOG_OUTPUTS } from './gaia-request-outputs';
import { ASTROMETRY_SPOTS, astrometryTable } from './gaia-request-pure';

const pull = (): Pull<'astrometry'> => ({
  archive: GAIA, outputs: GAIA_ASTROMETRY_CATALOG_OUTPUTS, release: GAIA_DR3_RELEASE, tables: { astrometry: astrometryTable(CATALOG_ASTROMETRY_REQUEST.read(), ASTROMETRY_SPOTS) },
});

export const describe = (): PullDescription => describePull(pull());
export const main = (): Promise<void> => runPull(pull());

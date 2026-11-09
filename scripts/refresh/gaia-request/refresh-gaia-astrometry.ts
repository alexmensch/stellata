// refresh:gaia-astrometry — Gaia DR3 astrometry for the binaries request. See README.md.

import type { PullDescription } from '../../util/emit-artifacts';
import { describePull, runPull, type Pull } from '../pull/pull';
import { GAIA, GAIA_DR3_RELEASE } from '../pull/tap-pure';
import { BINARIES_ASTROMETRY_REQUEST } from './binaries-astrometry-request-source';
import { GAIA_ASTROMETRY_OUTPUTS } from './gaia-request-outputs';
import { BINARIES_ASTROMETRY_SPOTS, astrometryTable } from './gaia-request-pure';

const pull = (): Pull<'astrometry'> => ({
  archive: GAIA, outputs: GAIA_ASTROMETRY_OUTPUTS, release: GAIA_DR3_RELEASE, tables: { astrometry: astrometryTable(BINARIES_ASTROMETRY_REQUEST.read(), BINARIES_ASTROMETRY_SPOTS) },
});

export const describe = (): PullDescription => describePull(pull());
export const main = (): Promise<void> => runPull(pull());

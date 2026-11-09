// refresh:gaia-magnitude — every gaiadr3.gaia_source row at G <= 11, membership's magnitude term. See README.md.

import type { PullDescription } from '../../util/emit-artifacts';
import { describePull, runPull, type Pull } from '../pull/pull';
import { GAIA, GAIA_DR3_RELEASE } from '../pull/tap-pure';
import { GAIA_MAGNITUDE_OUTPUTS } from './magnitude-outputs';
import { MAGNITUDE_TABLE } from './magnitude-pure';

export const MAGNITUDE_PULL: Pull<'magnitude'> = {
  archive: GAIA, outputs: GAIA_MAGNITUDE_OUTPUTS, release: GAIA_DR3_RELEASE, tables: { magnitude: MAGNITUDE_TABLE },
};

export const describe = (): PullDescription => describePull(MAGNITUDE_PULL);
export const main = (): Promise<void> => runPull(MAGNITUDE_PULL);

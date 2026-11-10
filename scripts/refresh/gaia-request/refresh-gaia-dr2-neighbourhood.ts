// refresh:gaia-dr2-neighbourhood — DR2 cross-match candidates for the frozen DR2 risk set. See README.md.

import { DR2_NEIGHBOURHOOD_REQUEST } from '../../sid/dr2-neighbourhood-source';
import type { PullDescription } from '../../util/emit-artifacts';
import { describePull, runPull, type Pull } from '../pull/pull';
import { GAIA, GAIA_DR3_RELEASE } from '../pull/tap-pure';
import { GAIA_DR2_NEIGHBOURHOOD_OUTPUTS } from './gaia-request-outputs';
import { dr2NeighbourhoodTable } from './gaia-request-pure';

const pull = (): Pull<'neighbourhood'> => ({
  archive: GAIA, outputs: GAIA_DR2_NEIGHBOURHOOD_OUTPUTS, release: GAIA_DR3_RELEASE, tables: { neighbourhood: dr2NeighbourhoodTable(DR2_NEIGHBOURHOOD_REQUEST.read()) },
});

export const describe = (): PullDescription => describePull(pull());
export const main = (): Promise<void> => runPull(pull());

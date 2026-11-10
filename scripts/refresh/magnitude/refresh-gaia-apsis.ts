// refresh:gaia-apsis — Gaia DR3 Apsis astrophysical parameters over the catalogue's deep population. See README.md.

import type { PullDescription } from '../../util/emit-artifacts';
import { CATALOG_ASTROMETRY_REQUEST } from '../gaia-request/catalog-astrometry-request-source';
import { describePhasedPull, runPhasedPull, type PhasedPull } from '../pull/pull';
import { GAIA, GAIA_DR3_RELEASE } from '../pull/tap-pure';
import { deepPopulationPull } from './deep-population-pure';
import { APSIS_TABLE } from './deep-population-tables-pure';
import { GAIA_APSIS_OUTPUTS } from './magnitude-outputs';

export const apsisPull = (request: readonly bigint[]): PhasedPull<'table'> => deepPopulationPull({
  archive: GAIA, outputs: GAIA_APSIS_OUTPUTS, release: GAIA_DR3_RELEASE, table: APSIS_TABLE, request,
});

export const describe = (): PullDescription => describePhasedPull(apsisPull(CATALOG_ASTROMETRY_REQUEST.read()));
export const main = (): Promise<void> => runPhasedPull(apsisPull(CATALOG_ASTROMETRY_REQUEST.read()));

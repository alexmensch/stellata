// refresh:bailer-jones — Bailer-Jones 2021 (/data/papers/index.md#bailerjones2021) distance posteriors over the catalogue's deep population. See README.md.

import type { PullDescription } from '../../util/emit-artifacts';
import { CATALOG_ASTROMETRY_REQUEST } from '../gaia-request/catalog-astrometry-request-source';
import { describePhasedPull, runPhasedPull, type PhasedPull } from '../pull/pull';
import { GAIA_ESA } from '../pull/tap-pure';
import { deepPopulationPull } from './deep-population-pure';
import { BAILER_JONES_TABLE } from './deep-population-tables-pure';
import { BAILER_JONES_OUTPUTS } from './magnitude-outputs';

export const BAILER_JONES_RELEASE = 'Bailer-Jones 2021 (Gaia EDR3)';

export const bailerJonesPull = (request: readonly bigint[]): PhasedPull<'table'> => deepPopulationPull({
  archive: GAIA_ESA, outputs: BAILER_JONES_OUTPUTS, release: BAILER_JONES_RELEASE, table: BAILER_JONES_TABLE, request,
});

export const describe = (): PullDescription => describePhasedPull(bailerJonesPull(CATALOG_ASTROMETRY_REQUEST.read()));
export const main = (): Promise<void> => runPhasedPull(bailerJonesPull(CATALOG_ASTROMETRY_REQUEST.read()));

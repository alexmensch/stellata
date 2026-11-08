// refresh:simbad-values — bibcoded SIMBAD values for the manifest rows a value tier can reach. See README.md.

import { MEMBERSHIP_MANIFEST } from '../../catalog/membership/membership-manifest-tsv';
import { GAIA_ASTROMETRY } from '../../catalog/sources/gaia-astrometry-source';
import type { PullDescription } from '../../util/emit-artifacts';
import { artifactRows } from '../../util/sources/source';
import { describePhasedPull, runPhasedPull } from '../pull/pull';
import { gaiaCompleteSourceIds } from '../simbad/membership-keys-pure';
import { SIMBAD_VALUES_OUTPUTS } from './simbad-values-outputs';
import { valuesPull } from './simbad-values-pure';

const pull = () => valuesPull(SIMBAD_VALUES_OUTPUTS, {
  records: () => artifactRows(MEMBERSHIP_MANIFEST),
  gaiaComplete: gaiaCompleteSourceIds(GAIA_ASTROMETRY.read()),
  requestFrom: [MEMBERSHIP_MANIFEST.file, GAIA_ASTROMETRY.file],
});

export const describe = (): PullDescription => describePhasedPull(pull());
export const main = (): Promise<void> => runPhasedPull(pull());

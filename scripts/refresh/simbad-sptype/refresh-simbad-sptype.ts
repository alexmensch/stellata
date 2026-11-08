// refresh:simbad-sptype — SIMBAD's spectral type and cross-IDs for every manifest row. See README.md.

import { MEMBERSHIP_MANIFEST } from '../../catalog/membership/membership-manifest-tsv';
import type { PullDescription } from '../../util/emit-artifacts';
import { artifactRows } from '../../util/sources/source';
import { describePhasedPull, runPhasedPull } from '../pull/pull';
import { SIMBAD_SPTYPE_OUTPUTS } from './simbad-sptype-outputs';
import { sptypePull } from './simbad-sptype-pure';

const pull = () => sptypePull(SIMBAD_SPTYPE_OUTPUTS, () => artifactRows(MEMBERSHIP_MANIFEST), [MEMBERSHIP_MANIFEST.file]);

export const describe = (): PullDescription => describePhasedPull(pull());
export const main = (): Promise<void> => runPhasedPull(pull());

// refresh:simbad — the V-stratified 50k SIMBAD sample the Tier-C validator reads. See README.md.

import type { PullDescription } from '../../util/emit-artifacts';
import { describePhasedPull, runPhasedPull } from '../pull/pull';
import { SIMBAD_SAMPLE_OUTPUTS } from './simbad-sample-outputs';
import { samplePull } from './simbad-sample-pure';

export const describe = (): PullDescription => describePhasedPull(samplePull(SIMBAD_SAMPLE_OUTPUTS));
export const main = (): Promise<void> => runPhasedPull(samplePull(SIMBAD_SAMPLE_OUTPUTS));

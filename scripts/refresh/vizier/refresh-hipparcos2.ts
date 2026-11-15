// refresh:hip2 — the Hipparcos-2 astrometric reduction. See README.md.

import type { PullDescription } from '../../util/emit-artifacts';
import { describePull, runPull } from '../pull/pull';
import { HIP2_PULL } from './vizier';

export const describe = (): PullDescription => describePull(HIP2_PULL);
export const main = (): Promise<void> => runPull(HIP2_PULL);

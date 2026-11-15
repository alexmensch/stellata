// refresh:gliese — the Gliese 1991 third catalogue of nearby stars. See README.md.

import type { PullDescription } from '../../util/emit-artifacts';
import { describePull, runPull } from '../pull/pull';
import { GLIESE_PULL } from './vizier';

export const describe = (): PullDescription => describePull(GLIESE_PULL);
export const main = (): Promise<void> => runPull(GLIESE_PULL);

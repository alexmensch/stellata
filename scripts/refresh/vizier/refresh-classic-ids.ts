// refresh:classic-ids — the four frozen CDS classic-designation cross indexes. See README.md.

import type { PullDescription } from '../../util/emit-artifacts';
import { describePull, runPull } from '../pull/pull';
import { CLASSIC_IDS_PULL } from './vizier';

export const describe = (): PullDescription => describePull(CLASSIC_IDS_PULL);
export const main = (): Promise<void> => runPull(CLASSIC_IDS_PULL);

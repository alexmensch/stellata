// refresh:gaia-hip — the HIP → Gaia DR3 best-neighbour cross-walk. See README.md.

import type { PullDescription } from '../../util/emit-artifacts';
import { describePull, runPull } from '../pull/pull';
import { HIP_XMATCH_PULL } from './gaia-whole-table';

export const describe = (): PullDescription => describePull(HIP_XMATCH_PULL);
export const main = (): Promise<void> => runPull(HIP_XMATCH_PULL);

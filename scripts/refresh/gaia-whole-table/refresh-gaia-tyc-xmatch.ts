// refresh:gaia-tyc — the Tycho-2 / TDSC → Gaia DR3 best-neighbour cross-walk. See README.md.

import type { PullDescription } from '../../util/emit-artifacts';
import { describePull, runPull } from '../pull/pull';
import { TYC_XMATCH_PULL } from './gaia-whole-table';

export const describe = (): PullDescription => describePull(TYC_XMATCH_PULL);
export const main = (): Promise<void> => runPull(TYC_XMATCH_PULL);

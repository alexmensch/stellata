// refresh:msc — Tokovinin's Multiple Star Catalog, its three tables. See README.md.

import type { PullDescription } from '../../util/emit-artifacts';
import { describePull, runPull } from '../pull/pull';
import { MSC_PULL } from './vizier';

export const describe = (): PullDescription => describePull(MSC_PULL);
export const main = (): Promise<void> => runPull(MSC_PULL);

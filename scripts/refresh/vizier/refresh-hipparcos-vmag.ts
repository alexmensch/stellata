// refresh:hip-vmag — printed Johnson V and B−V from the Hipparcos main catalogue. See README.md.

import type { PullDescription } from '../../util/emit-artifacts';
import { describePull, runPull } from '../pull/pull';
import { HIP_VMAG_PULL } from './vizier';

export const describe = (): PullDescription => describePull(HIP_VMAG_PULL);
export const main = (): Promise<void> => runPull(HIP_VMAG_PULL);

// refresh:gaia-nss — Gaia DR3 nss_two_body_orbit, whole. See README.md.

import type { PullDescription } from '../../util/emit-artifacts';
import { describePull, runPull } from '../pull/pull';
import { NSS_PULL } from './gaia-whole-table';

export const describe = (): PullDescription => describePull(NSS_PULL);
export const main = (): Promise<void> => runPull(NSS_PULL);

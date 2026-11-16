// refresh:tycho2 — Tycho-2's main table and supplement 1, filtered to the TYCs the manifest and IV/25 mention and the manifest's HIPs. See README.md.

import type { PullDescription } from '../../util/emit-artifacts';
import { describePhasedPull, runPhasedPull } from '../pull/pull';
import { readTycRequest } from './tyc-request';
import { TYCHO2_OUTPUTS } from './tycho2-outputs';
import { tycho2Pull } from './tycho2-pure';

const pull = () => tycho2Pull(TYCHO2_OUTPUTS, readTycRequest());

export const describe = (): PullDescription => describePhasedPull(pull());
export const main = (): Promise<void> => runPhasedPull(pull());

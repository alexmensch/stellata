// refresh:simbad-tyc-hd — SIMBAD's own HD identification per Tycho-2 entry, keyed on TYC. See README.md.

import type { PullDescription } from '../../util/emit-artifacts';
import { describePhasedPull, runPhasedPull } from '../pull/pull';
import { readTycRequest } from '../tycho2/tyc-request';
import { SIMBAD_TYC_HD_OUTPUTS } from './simbad-tyc-hd-outputs';
import { tycHdPull } from './simbad-tyc-hd-pure';

const pull = () => tycHdPull(SIMBAD_TYC_HD_OUTPUTS, readTycRequest());

export const describe = (): PullDescription => describePhasedPull(pull());
export const main = (): Promise<void> => runPhasedPull(pull());

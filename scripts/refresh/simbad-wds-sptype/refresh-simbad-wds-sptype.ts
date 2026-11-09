// refresh:simbad-wds-sptype — SIMBAD's sp_type for every WDS component oid. See README.md.

import type { PullDescription } from '../../util/emit-artifacts';
import { describePull, runPull, type Pull } from '../pull/pull';
import { SIMBAD } from '../pull/tap-pure';
import { SIMBAD_WDS_XIDS } from '../../catalog/membership/binding/simbad-wds-xids-source';
import { SIMBAD_WDS_SPTYPE_OUTPUTS } from './simbad-wds-sptype-outputs';
import { wdsOids, wdsSptypeTable } from './simbad-wds-sptype-pure';

function pull(): Pull<'sptype'> {
  return { archive: SIMBAD, outputs: SIMBAD_WDS_SPTYPE_OUTPUTS, tables: { sptype: wdsSptypeTable(wdsOids(SIMBAD_WDS_XIDS.read())) } };
}

export const describe = (): PullDescription => describePull(pull());
export const main = (): Promise<void> => runPull(pull());

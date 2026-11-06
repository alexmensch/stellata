// refresh:simbad-wds-sptype — SIMBAD's sp_type for every WDS component oid. See README.md.

import type { PullDescription } from '../../util/emit-artifacts';
import { describePull, runPull, type Pull } from '../pull/pull';
import { SIMBAD } from '../pull/tap-pure';
import { SIMBAD_WDS_OIDS } from './simbad-wds-oids-source';
import { SIMBAD_WDS_SPTYPE_OUTPUTS } from './simbad-wds-sptype-outputs';
import { wdsSptypeTable } from './simbad-wds-sptype-pure';

function pull(): Pull<'sptype'> {
  return { archive: SIMBAD, outputs: SIMBAD_WDS_SPTYPE_OUTPUTS, tables: { sptype: wdsSptypeTable(SIMBAD_WDS_OIDS.read()) } };
}

export const describe = (): PullDescription => describePull(pull());
export const main = (): Promise<void> => runPull(pull());

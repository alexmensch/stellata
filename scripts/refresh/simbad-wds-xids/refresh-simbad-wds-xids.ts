// refresh:simbad-wds-xids — each WDS component's SIMBAD object and its Gaia DR3 and HIP ids. See README.md.

import type { PullDescription } from '../../util/emit-artifacts';
import { WDS_SUMM } from '../../wds/wds-source';
import { describePhasedPull, runPhasedPull, type PhasedPull } from '../pull/pull';
import { SIMBAD_WDS_XIDS_OUTPUTS } from './simbad-wds-xids-outputs';
import { xidsPull } from './simbad-wds-xids-pure';
import { wdsComponents } from './wds-components-pure';
import { WDS_XIDS_OVERRIDES } from './wds-xids-overrides-source';

function pull(): PhasedPull<'xids'> {
  return xidsPull(SIMBAD_WDS_XIDS_OUTPUTS, {
    components: wdsComponents(WDS_SUMM.read()),
    overrides: WDS_XIDS_OVERRIDES.read(),
    overridesFile: WDS_XIDS_OVERRIDES.file,
    requestFrom: [WDS_SUMM.file, WDS_XIDS_OVERRIDES.file],
  });
}

export const describe = (): PullDescription => describePhasedPull(pull());
export const main = (): Promise<void> => runPhasedPull(pull());

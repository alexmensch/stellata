// The whole-table VizieR pulls as Pull values, one per step. See README.md.

import type { Pull } from '../pull/pull';
import { VIZIER } from '../pull/tap-pure';
import { CLASSIC_IDS_OUTPUTS, GLIESE_OUTPUTS, HIP2_OUTPUTS, HIP_VMAG_OUTPUTS, MSC_OUTPUTS } from './vizier-outputs';
import {
  BSC5, CNS5, CROSS_INDEX, GLIESE, HIP2, HIP_MAIN_VMAG, MSC_COMPONENTS, MSC_ORBITS, MSC_SYSTEMS, TYC2_HD,
} from './vizier-pure';

const release = (...tables: string[]): string => tables.map((t) => `VizieR ${t}`).join(', ');

export const CLASSIC_IDS_PULL: Pull<'tyc2Hd' | 'crossIndex' | 'bsc5' | 'cns5'> = {
  archive: VIZIER,
  outputs: CLASSIC_IDS_OUTPUTS,
  release: release('IV/25/tyc2_hd', 'IV/27A/catalog', 'V/50/catalog', 'J/A+A/670/A19/cns5'),
  tables: { tyc2Hd: TYC2_HD, crossIndex: CROSS_INDEX, bsc5: BSC5, cns5: CNS5 },
};

export const HIP_VMAG_PULL: Pull<'hipMainVmag'> = {
  archive: VIZIER, outputs: HIP_VMAG_OUTPUTS, release: release('I/239/hip_main'), tables: { hipMainVmag: HIP_MAIN_VMAG },
};

export const GLIESE_PULL: Pull<'gliese'> = {
  archive: VIZIER, outputs: GLIESE_OUTPUTS, release: release('V/70A/catalog'), tables: { gliese: GLIESE },
};

export const HIP2_PULL: Pull<'hip2'> = { archive: VIZIER, outputs: HIP2_OUTPUTS, release: release('I/311/hip2'), tables: { hip2: HIP2 } };

export const MSC_PULL: Pull<'systems' | 'orbits' | 'components'> = {
  archive: VIZIER,
  outputs: MSC_OUTPUTS,
  release: release('J/ApJS/235/6/systems', 'J/ApJS/235/6/orbits', 'J/ApJS/235/6/catalog'),
  tables: { systems: MSC_SYSTEMS, orbits: MSC_ORBITS, components: MSC_COMPONENTS },
};

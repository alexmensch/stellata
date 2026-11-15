// The whole-table VizieR pulls as Pull values, one per step. See README.md.

import type { DeclaredOutputs } from '../../util/emit-artifacts';
import type { Pull } from '../pull/pull';
import { VIZIER } from '../pull/tap-pure';
import { CLASSIC_IDS_OUTPUTS, GLIESE_OUTPUTS, HIP2_OUTPUTS, HIP_VMAG_OUTPUTS, MSC_OUTPUTS } from './vizier-outputs';
import {
  BSC5, CNS5, CROSS_INDEX, GLIESE, HIP2, HIP_MAIN_VMAG, MSC_COMPONENTS, MSC_ORBITS, MSC_SYSTEMS, TYC2_HD,
  vizierRelease, type VizierTable,
} from './vizier-pure';

const vizierPull = <K extends string>(outputs: DeclaredOutputs<K>, tables: Record<K, VizierTable>): Pull<K> => ({
  archive: VIZIER, outputs, release: vizierRelease(Object.values<VizierTable>(tables)), tables,
});

export const CLASSIC_IDS_PULL = vizierPull(CLASSIC_IDS_OUTPUTS, { tyc2Hd: TYC2_HD, crossIndex: CROSS_INDEX, bsc5: BSC5, cns5: CNS5 });
export const HIP_VMAG_PULL = vizierPull(HIP_VMAG_OUTPUTS, { hipMainVmag: HIP_MAIN_VMAG });
export const GLIESE_PULL = vizierPull(GLIESE_OUTPUTS, { gliese: GLIESE });
export const HIP2_PULL = vizierPull(HIP2_OUTPUTS, { hip2: HIP2 });
export const MSC_PULL = vizierPull(MSC_OUTPUTS, { systems: MSC_SYSTEMS, orbits: MSC_ORBITS, components: MSC_COMPONENTS });

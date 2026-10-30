// Every stage that writes lineage, in pipeline order, with its codes and its files: what the code list is generated from and trace reads, in that order. See README.md#reason-codes--closed-append-only-generated.

import { ALLOCATION_CODES, ALLOCATION_LINEAGE } from '../../sid/allocation-lineage-pure';
import { PROMOTION_CODES, PROMOTION_LINEAGE } from '../companions/promotion-lineage-pure';
import { PLACEMENT_CODES, PLACEMENT_LINEAGE } from '../distance/placement-lineage-pure';
import { MEMBERSHIP_CODES, MEMBERSHIP_LINEAGE } from '../membership/membership-lineage-pure';
import type { StageLineageSpec } from './lineage-io';
import type { StageCodes } from './reason-codes-pure';

export interface LineageStage {
  readonly codes: StageCodes<string>;
  readonly spec: StageLineageSpec<string>;
}

export const LINEAGE_STAGES: readonly LineageStage[] = [
  { codes: MEMBERSHIP_CODES, spec: MEMBERSHIP_LINEAGE },
  { codes: PLACEMENT_CODES, spec: PLACEMENT_LINEAGE },
  { codes: PROMOTION_CODES, spec: PROMOTION_LINEAGE },
  { codes: ALLOCATION_CODES, spec: ALLOCATION_LINEAGE },
];

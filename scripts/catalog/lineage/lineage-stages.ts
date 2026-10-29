// Every stage that writes lineage, in pipeline order, with its codes and its files: what the code list is generated from and trace reads, in that order. See README.md#reason-codes--closed-append-only-generated.

import { PROMOTION_CODES, PROMOTION_LINEAGE } from '../companions/promotion-lineage-pure';
import { MEMBERSHIP_CODES, MEMBERSHIP_LINEAGE } from '../membership/membership-lineage-pure';
import type { StageLineageSpec } from './lineage-io';
import type { StageCodes } from './reason-codes-pure';

export interface LineageStage {
  readonly codes: StageCodes<string>;
  readonly spec: StageLineageSpec<string>;
}

export const LINEAGE_STAGES: readonly LineageStage[] = [
  { codes: MEMBERSHIP_CODES, spec: MEMBERSHIP_LINEAGE },
  { codes: PROMOTION_CODES, spec: PROMOTION_LINEAGE },
];

// Every stage that writes lineage, in pipeline order, with its codes and its files: what the code list is generated from and trace reads, in that order. See README.md#reason-codes--closed-append-only-generated.

import { ALLOCATION_CODES } from '../../sid/allocation-lineage-pure';
import { SIBLING_ARTIFACTS } from '../../sid/sibling-artifacts-pure';
import { PROMOTION_CODES } from '../companions/promotion-lineage-pure';
import { PLACEMENT_CODES } from '../distance/placement-lineage-pure';
import { MEMBERSHIP_CODES } from '../membership/membership-lineage-pure';
import type { StageCodes } from './reason-codes-pure';
import {
  ALLOCATION_LINEAGE, PROMOTION_LINEAGE, PLACEMENT_LINEAGE, MEMBERSHIP_LINEAGE, type StageLineageSpec,
} from '../../../src/catalog-format/pipeline-outputs/lineage-files';

export interface LineageStage {
  readonly codes: StageCodes<string>;
  readonly spec: StageLineageSpec<string>;
}

export const LINEAGE_STAGES: readonly LineageStage[] = [
  { codes: MEMBERSHIP_CODES, spec: MEMBERSHIP_LINEAGE },
  { codes: PLACEMENT_CODES, spec: PLACEMENT_LINEAGE },
  { codes: PROMOTION_CODES, spec: PROMOTION_LINEAGE },
  { codes: ALLOCATION_CODES, spec: ALLOCATION_LINEAGE },
  ...Object.values(SIBLING_ARTIFACTS).map(({ codes, lineage }) => ({ codes, spec: lineage })),
];

// Every stage that writes lineage, in pipeline order, with its codes and its files: what the code list is generated from and trace reads, in that order. See reason-codes/README.md.

import { ALLOCATION_CODES } from '../../sid/allocation-lineage-pure';
import { SIBLING_ARTIFACTS } from '../../sid/sibling-artifacts-pure';
import { CLASSIC_ID_CODES } from '../classic-ids/classic-id-lineage-pure';
import { PROMOTION_CODES } from '../companions/promotion-lineage-pure';
import { PLACEMENT_CODES } from '../distance/placement-lineage-pure';
import { MEMBERSHIP_CODES } from '../membership/membership-lineage-pure';
import { COHERENCE_CODES } from '../multiplicity/coherence-lineage-pure';
import { NAMING_CODES } from '../naming/naming-lineage-pure';
import { BRIGHTNESS_COLOUR_CODES } from '../photometry/brightness-colour-lineage-pure';
import { SIZE_CODES } from '../spectral/size-lineage-pure';
import type { StageCodes } from './reason-codes/reason-codes-pure';
import {
  ALLOCATION_LINEAGE, BRIGHTNESS_COLOUR_LINEAGE, CLASSIC_IDS_LINEAGE, COHERENCE_LINEAGE, PROMOTION_LINEAGE, PLACEMENT_LINEAGE, MEMBERSHIP_LINEAGE,
  NAMING_LINEAGE, SIZE_LINEAGE,
  type StageLineageSpec,
} from '../../../src/catalog-format/pipeline-outputs/lineage-files';

export interface LineageStage {
  readonly codes: StageCodes<string>;
  readonly spec: StageLineageSpec<string>;
}

export const LINEAGE_STAGES: readonly LineageStage[] = [
  { codes: CLASSIC_ID_CODES, spec: CLASSIC_IDS_LINEAGE },
  { codes: MEMBERSHIP_CODES, spec: MEMBERSHIP_LINEAGE },
  { codes: PLACEMENT_CODES, spec: PLACEMENT_LINEAGE },
  { codes: BRIGHTNESS_COLOUR_CODES, spec: BRIGHTNESS_COLOUR_LINEAGE },
  { codes: SIZE_CODES, spec: SIZE_LINEAGE },
  { codes: COHERENCE_CODES, spec: COHERENCE_LINEAGE },
  { codes: PROMOTION_CODES, spec: PROMOTION_LINEAGE },
  { codes: ALLOCATION_CODES, spec: ALLOCATION_LINEAGE },
  { codes: NAMING_CODES, spec: NAMING_LINEAGE },
  ...Object.values(SIBLING_ARTIFACTS).map(({ codes, lineage }) => ({ codes, spec: lineage })),
];

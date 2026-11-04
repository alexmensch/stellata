// Every file build:membership writes, as its emitArtifacts declaration. See README.md#files-in-this-area.

import { declareOutputs } from '../../util/emit-artifacts';
import { LINEAGE_LAYOUT, stageFamilies, stageOutputFiles } from '../lineage/lineage-layout-pure';
import { MEMBERSHIP_LINEAGE } from './membership-lineage-pure';
import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';

export const MEMBERSHIP_OUTPUTS = declareOutputs({
  labelFlips: DATA_FILES.labelFlips,
  manifest: DATA_FILES.membershipManifest,
  additions: DATA_FILES.additionsLedger,
  bindingReview: DATA_FILES.bindingReview,
  labelDrops: DATA_FILES.labelDrops,
  ...stageOutputFiles(LINEAGE_LAYOUT, MEMBERSHIP_LINEAGE),
}, stageFamilies(LINEAGE_LAYOUT, MEMBERSHIP_LINEAGE));

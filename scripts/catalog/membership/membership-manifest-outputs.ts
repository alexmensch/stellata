// Every file build:membership writes, as its emitArtifacts declaration. See README.md#files-in-this-area.

import { declareOutputs } from '../../util/emit-artifacts';
import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import {
  LINEAGE_REPO_LAYOUT, stageFamilies, stageOutputFiles, MEMBERSHIP_LINEAGE,
} from '../../../src/catalog-format/pipeline-outputs/lineage-files';

export const MEMBERSHIP_OUTPUTS = declareOutputs({
  labelFlips: DATA_FILES.labelFlips,
  manifest: DATA_FILES.membershipManifest,
  additions: DATA_FILES.additionsLedger,
  bindingReview: DATA_FILES.bindingReview,
  labelDrops: DATA_FILES.labelDrops,
  ...stageOutputFiles(LINEAGE_REPO_LAYOUT, MEMBERSHIP_LINEAGE),
}, stageFamilies(LINEAGE_REPO_LAYOUT, MEMBERSHIP_LINEAGE));

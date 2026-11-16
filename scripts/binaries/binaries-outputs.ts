// Every file build:binaries writes, as its emitArtifacts declaration. See README.md#files-in-this-area.

import { declareOutputs } from '../util/emit-artifacts';
import { BUILD_FILES } from '../../src/catalog-format/pipeline-outputs/build-files';
import { DATA_FILES } from '../../src/catalog-format/pipeline-outputs/data-files';
import {
  ANCHORS_LINEAGE, ASTROMETRY_LINEAGE, BINDING_LINEAGE, LINEAGE_REPO_LAYOUT, MASSES_LINEAGE, ORBITS_LINEAGE, PAIRS_LINEAGE, RESOLVE_LINEAGE,
  stageFamilies, stagesOutputFiles,
} from '../../src/catalog-format/pipeline-outputs/lineage-files';

export const BINARIES_LINEAGE = [
  BINDING_LINEAGE, RESOLVE_LINEAGE, ASTROMETRY_LINEAGE, ORBITS_LINEAGE, PAIRS_LINEAGE, ANCHORS_LINEAGE, MASSES_LINEAGE,
] as const;

export const BINARIES_OUTPUTS = declareOutputs({
  multiples: DATA_FILES.multiples,
  bindingVerdicts: BUILD_FILES.bindingVerdicts,
  ...stagesOutputFiles(LINEAGE_REPO_LAYOUT, BINARIES_LINEAGE),
}, BINARIES_LINEAGE.flatMap((spec) => stageFamilies(LINEAGE_REPO_LAYOUT, spec)));

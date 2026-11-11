// Every file build-catalog.ts writes: its emitArtifacts declaration. See README.md#files-in-this-area.

import { dirname } from 'node:path';

import { declareOutputs } from '../util/emit-artifacts';
import { publicFile } from '../util/paths';
import { CATALOG_CHUNK_FILENAME, CATALOG_MANIFEST_FILENAME } from '../../src/catalog-format/record/catalog-pure';
import { BUILD_FILES } from '../../src/catalog-format/pipeline-outputs/build-files';
import { DATA_FILES, registryFiles, CATALOG_PARTITION } from '../../src/catalog-format/pipeline-outputs/data-files';
import { PUBLIC_FILES } from '../../src/catalog-format/public-artifacts/public-artifacts';
import {
  PROMOTION_LINEAGE, PLACEMENT_LINEAGE, BRIGHTNESS_COLOUR_LINEAGE, LINEAGE_REPO_LAYOUT, stageFamilies, stageOutputFiles,
  ALLOCATION_LINEAGE, COHERENCE_LINEAGE, NAMING_LINEAGE, SIZE_LINEAGE,
} from '../../src/catalog-format/pipeline-outputs/lineage-files';

const MANIFEST = publicFile(CATALOG_MANIFEST_FILENAME);
export const CATALOG_CHUNK_DIR = dirname(MANIFEST);

export const CATALOG_OUTPUTS = declareOutputs(
  {
    manifest: MANIFEST,
    constellations: publicFile(PUBLIC_FILES.constellations),
    boundaries: publicFile(PUBLIC_FILES.boundaries),
    searchIndex: publicFile(PUBLIC_FILES.searchIndex),
    rowIndexMap: BUILD_FILES.catalogRowIndexMap,
    parkedLedger: DATA_FILES.parkedLedger,
    simbadSourcedDistances: DATA_FILES.simbadSourcedDistances,
    ...stageOutputFiles(LINEAGE_REPO_LAYOUT, PLACEMENT_LINEAGE),
    ...stageOutputFiles(LINEAGE_REPO_LAYOUT, BRIGHTNESS_COLOUR_LINEAGE),
    ...stageOutputFiles(LINEAGE_REPO_LAYOUT, SIZE_LINEAGE),
    ...stageOutputFiles(LINEAGE_REPO_LAYOUT, COHERENCE_LINEAGE),
    ...stageOutputFiles(LINEAGE_REPO_LAYOUT, PROMOTION_LINEAGE),
    ...stageOutputFiles(LINEAGE_REPO_LAYOUT, ALLOCATION_LINEAGE),
    ...stageOutputFiles(LINEAGE_REPO_LAYOUT, NAMING_LINEAGE),
    ...registryFiles(CATALOG_PARTITION),
  },
  [
    { dir: CATALOG_CHUNK_DIR, member: CATALOG_CHUNK_FILENAME, stamped: true },
    ...stageFamilies(LINEAGE_REPO_LAYOUT, PLACEMENT_LINEAGE),
    ...stageFamilies(LINEAGE_REPO_LAYOUT, BRIGHTNESS_COLOUR_LINEAGE),
    ...stageFamilies(LINEAGE_REPO_LAYOUT, SIZE_LINEAGE),
    ...stageFamilies(LINEAGE_REPO_LAYOUT, COHERENCE_LINEAGE),
    ...stageFamilies(LINEAGE_REPO_LAYOUT, PROMOTION_LINEAGE),
    ...stageFamilies(LINEAGE_REPO_LAYOUT, ALLOCATION_LINEAGE),
    ...stageFamilies(LINEAGE_REPO_LAYOUT, NAMING_LINEAGE),
  ],
);

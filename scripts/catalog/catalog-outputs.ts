// Every file build-catalog.ts writes: its emitArtifacts declaration. See README.md#files-in-this-area.

import { dirname } from 'node:path';

import { declareOutputs } from '../util/emit-artifacts';
import {
  DEFAULT_BOUNDARIES, DEFAULT_CATALOG_MANIFEST, DEFAULT_CONSTELLATIONS_JSON, DEFAULT_ROW_INDEX_MAP, DEFAULT_SEARCH_INDEX,
} from './catalog-paths-pure';
import { PROMOTION_LINEAGE } from './companions/promotion-lineage-pure';
import { PLACEMENT_LINEAGE } from './distance/placement-lineage-pure';
import { LINEAGE_LAYOUT, stageFamilies, stageOutputFiles } from './lineage/lineage-layout-pure';
import { CATALOG_CHUNK_FILENAME } from '../../src/catalog-format/record/catalog-pure';
import { DATA_FILES } from '../../src/catalog-format/pipeline-outputs/data-files';
import { ALLOCATION_LINEAGE } from '../sid/allocation-lineage-pure';
import { registryFiles } from '../sid/registry-outputs';
import { CATALOG_PARTITION } from '../sid/registry-partitions-pure';

export const CATALOG_CHUNK_DIR = dirname(DEFAULT_CATALOG_MANIFEST);

export const CATALOG_OUTPUTS = declareOutputs(
  {
    manifest: DEFAULT_CATALOG_MANIFEST,
    constellations: DEFAULT_CONSTELLATIONS_JSON,
    boundaries: DEFAULT_BOUNDARIES,
    searchIndex: DEFAULT_SEARCH_INDEX,
    rowIndexMap: DEFAULT_ROW_INDEX_MAP,
    parkedLedger: DATA_FILES.parkedLedger,
    simbadSourcedDistances: DATA_FILES.simbadSourcedDistances,
    ...stageOutputFiles(LINEAGE_LAYOUT, PLACEMENT_LINEAGE),
    ...stageOutputFiles(LINEAGE_LAYOUT, PROMOTION_LINEAGE),
    ...stageOutputFiles(LINEAGE_LAYOUT, ALLOCATION_LINEAGE),
    ...registryFiles(CATALOG_PARTITION),
  },
  [
    { dir: CATALOG_CHUNK_DIR, member: CATALOG_CHUNK_FILENAME, stamped: true },
    ...stageFamilies(LINEAGE_LAYOUT, PLACEMENT_LINEAGE),
    ...stageFamilies(LINEAGE_LAYOUT, PROMOTION_LINEAGE),
    ...stageFamilies(LINEAGE_LAYOUT, ALLOCATION_LINEAGE),
  ],
);

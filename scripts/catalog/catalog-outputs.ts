// Every file build-catalog.ts writes: its emitArtifacts declaration. See README.md#files-in-this-area.

import { dirname, resolve } from 'node:path';

import { declareOutputs } from '../util/emit-artifacts';
import { REPO_ROOT } from '../util/paths';
import {
  DEFAULT_CATALOG_MANIFEST, DEFAULT_CONSTELLATIONS_JSON, DEFAULT_ROW_INDEX_MAP, DEFAULT_SEARCH_INDEX,
} from './catalog-lookup';
import { PARKED_LEDGER } from './distance/parallax/parked-ledger-tsv';
import { SIMBAD_SOURCED_DISTANCES_FILE } from './distance/parallax/simbad-sourced-ledger-tsv';
import { CATALOG_CHUNK_FILENAME } from './record/catalog-pure';

export const CATALOG_CHUNK_DIR = dirname(DEFAULT_CATALOG_MANIFEST);
export const OUT_BOUNDARIES = resolve(REPO_ROOT, 'public/constellation-boundaries.json');

export const CATALOG_OUTPUTS = declareOutputs(
  {
    manifest: DEFAULT_CATALOG_MANIFEST,
    constellations: DEFAULT_CONSTELLATIONS_JSON,
    boundaries: OUT_BOUNDARIES,
    searchIndex: DEFAULT_SEARCH_INDEX,
    rowIndexMap: DEFAULT_ROW_INDEX_MAP,
    parkedLedger: resolve(REPO_ROOT, PARKED_LEDGER.file),
    simbadSourcedDistances: resolve(REPO_ROOT, SIMBAD_SOURCED_DISTANCES_FILE),
  },
  [{ dir: CATALOG_CHUNK_DIR, member: CATALOG_CHUNK_FILENAME }],
);

// Every file build-catalog.ts writes: its emitArtifacts declaration. See README.md#files-in-this-area.

import { dirname, resolve } from 'node:path';

import { declareOutputs } from '../util/emit-artifacts';
import { REPO_ROOT } from '../util/paths';
import {
  DEFAULT_CATALOG_MANIFEST, DEFAULT_CONSTELLATIONS_JSON, DEFAULT_ROW_INDEX_MAP, DEFAULT_SEARCH_INDEX,
} from './catalog-lookup';
import { PARKED_LEDGER_FILE } from './distance/parallax/parked-ledger';
import { SIMBAD_SOURCED_DISTANCES_FILE } from './distance/parallax/simbad-sourced-ledger';
import { CATALOG_CHUNK_FILENAME } from './record/catalog-pure';

export const CATALOG_CHUNK_DIR = dirname(DEFAULT_CATALOG_MANIFEST);
export const OUT_BOUNDARIES = resolve(REPO_ROOT, 'public/constellation-boundaries.json');
export const OUT_PARKED = resolve(REPO_ROOT, PARKED_LEDGER_FILE);
export const OUT_SIMBAD_SOURCED = resolve(REPO_ROOT, SIMBAD_SOURCED_DISTANCES_FILE);

export const CATALOG_OUTPUTS = declareOutputs(
  [
    DEFAULT_CATALOG_MANIFEST, DEFAULT_CONSTELLATIONS_JSON, OUT_BOUNDARIES, DEFAULT_SEARCH_INDEX,
    DEFAULT_ROW_INDEX_MAP, OUT_PARKED, OUT_SIMBAD_SOURCED,
  ],
  [{ dir: CATALOG_CHUNK_DIR, member: CATALOG_CHUNK_FILENAME }],
);

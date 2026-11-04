// Where the built catalogue's files land, for its writer and its readers. See README.md#files-in-this-area.

import { resolve } from 'node:path';

import { REPO_ROOT, publicFile } from '../util/paths';
import { CATALOG_MANIFEST_FILENAME } from '../../src/catalog-format/record/catalog-pure';
import { PUBLIC_FILES } from '../../src/catalog-format/public-artifacts/public-artifacts';

export const DEFAULT_CATALOG_MANIFEST = publicFile(CATALOG_MANIFEST_FILENAME);
export const DEFAULT_CONSTELLATIONS_JSON = publicFile(PUBLIC_FILES.constellations);
/** The two sidecars a record's full designation set needs beyond the binary —
 *  `hd`/`hr`/`gl` and the synthetic keys. */
export const DEFAULT_SEARCH_INDEX = publicFile(PUBLIC_FILES.searchIndex);
export const DEFAULT_BOUNDARIES = publicFile(PUBLIC_FILES.boundaries);
/** Build-time hand-off, never shipped: `build/` sits outside Vite's `publicDir`. */
export const DEFAULT_ROW_INDEX_MAP = resolve(REPO_ROOT, 'build/catalog-row-index-map.json');

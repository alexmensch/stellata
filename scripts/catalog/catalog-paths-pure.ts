// Where the built catalogue's files land, for its writer and its readers. See README.md#files-in-this-area.

import { resolve } from 'node:path';

import { REPO_ROOT } from '../util/paths';
import { CATALOG_MANIFEST_FILENAME } from '../../src/catalog-format/record/catalog-pure';

export const DEFAULT_CATALOG_MANIFEST = resolve(REPO_ROOT, 'public', CATALOG_MANIFEST_FILENAME);
export const DEFAULT_CONSTELLATIONS_JSON = resolve(REPO_ROOT, 'public/constellations.json');
/** The two sidecars a record's full designation set needs beyond the binary —
 *  `hd`/`hr`/`gl` and the synthetic keys. */
export const DEFAULT_SEARCH_INDEX = resolve(REPO_ROOT, 'public/search-index.json');
/** Build-time hand-off, never shipped: `build/` sits outside Vite's `publicDir`. */
export const DEFAULT_ROW_INDEX_MAP = resolve(REPO_ROOT, 'build/catalog-row-index-map.json');

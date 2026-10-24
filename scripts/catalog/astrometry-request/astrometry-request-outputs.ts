// The file build:astrometry-request writes, as its emitArtifacts declaration. See README.md#files-in-this-area.

import { resolve } from 'node:path';

import { declareOutputs } from '../../util/emit-artifacts';
import { REPO_ROOT } from '../../util/paths';

export const ASTROMETRY_REQUEST_OUTPUTS = declareOutputs({
  request: resolve(REPO_ROOT, 'data/gaia/gaia_catalog_source_id_request.tsv'),
});

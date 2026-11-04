// The file build:astrometry-request writes, as its emitArtifacts declaration. See README.md#files-in-this-area.

import { declareOutputs } from '../../util/emit-artifacts';

export const ASTROMETRY_REQUEST_OUTPUTS = declareOutputs({
  request: 'data/gaia/gaia_catalog_source_id_request.tsv',
});

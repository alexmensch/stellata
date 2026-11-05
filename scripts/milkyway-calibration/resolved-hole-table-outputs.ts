// The one file measure:band-resolved writes, as its emitArtifacts declaration. See README.md.

import { declareOutputs } from '../util/emit-artifacts';

export const RESOLVED_HOLE_TABLE_OUTPUTS = declareOutputs({
  table: 'src/astro-core/milkyway/calibration/resolved-hole-table.ts',
});

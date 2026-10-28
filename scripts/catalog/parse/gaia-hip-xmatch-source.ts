// The Gaia DR3 best-neighbour cross-walk onto HIP, declared.

import { defineSource } from '../../util/sources/source';
import { parseGaiaHipXmatchTsv } from './gaia-xmatch';

export const GAIA_HIP_XMATCH = defineSource({
  file: 'data/gaia/gaia_dr3_hip_xmatch.tsv',
  hint: 'Re-run `pnpm run refresh:gaia-hip`.',
  parse: (input) => parseGaiaHipXmatchTsv(input.text(), input),
});

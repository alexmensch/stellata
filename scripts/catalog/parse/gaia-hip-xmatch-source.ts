// The Gaia DR3 best-neighbour cross-walk onto HIP, declared.

import { defineSource, type Declared } from '../../util/sources/source';
import { parseGaiaHipXmatchTsv } from './gaia-xmatch';

const FROM: Declared = {
  file: 'data/gaia/gaia_dr3_hip_xmatch.tsv',
  hint: 'Re-run `pnpm run refresh:gaia-hip`.',
};

export const GAIA_HIP_XMATCH = defineSource({
  ...FROM,
  parse: (input) => parseGaiaHipXmatchTsv(input.text(), FROM),
});

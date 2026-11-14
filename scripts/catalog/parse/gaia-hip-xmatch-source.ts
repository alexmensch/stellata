// The Gaia DR3 best-neighbour cross-walk onto HIP, declared.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource } from '../../util/sources/source';
import { parseGaiaHipXmatchTsv } from './gaia-xmatch';

export const GAIA_HIP_XMATCH = defineSource({
  file: DATA_FILES.gaiaHipXmatch,
  hint: 'Re-run `pnpm run refresh:gaia-hip`.',
  rowKey: { id: 'gaia-dr3-hip', text: (hip: number) => String(hip) },
  parse: (input) => parseGaiaHipXmatchTsv(input.text(), input),
});

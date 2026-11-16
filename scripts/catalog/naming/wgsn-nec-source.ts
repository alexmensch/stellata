// The IAU WGSN names table (NEC.csv), declared.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource } from '../../util/sources/source';
import { parseNecCsv } from './wgsn-parse-pure';

export const WGSN_NEC = defineSource({
  file: DATA_FILES.wgsnNec,
  hint: 'Re-run `pnpm run refresh:iau-wgsn`.',
  parse: (input) => parseNecCsv(input.text(), input),
});

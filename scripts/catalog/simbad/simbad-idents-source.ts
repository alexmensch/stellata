// SIMBAD's designation idents per object, declared.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource } from '../../util/sources/source';
import { parseSimbadIdentsTsv } from './simbad-idents-parse';

export const SIMBAD_IDENTS = defineSource({
  file: DATA_FILES.simbadIdents,
  hint: 'Re-run `pnpm run refresh:simbad-idents`.',
  parse: (input) => parseSimbadIdentsTsv(input.text(), input),
});

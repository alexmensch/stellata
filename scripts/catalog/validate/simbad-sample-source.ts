// The stratified SIMBAD cross-check sample, declared.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource } from '../../util/sources/source';
import { parseSimbadSampleRows } from './simbad-sample-parse';

export const SIMBAD_SAMPLE = defineSource({
  file: DATA_FILES.simbadSample,
  hint: 'Re-run `pnpm run refresh:simbad`.',
  parse: (input) => parseSimbadSampleRows(input.text(), input),
});

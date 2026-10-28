// The stratified SIMBAD cross-check sample, declared.

import { defineSource } from '../../util/sources/source';
import { parseSimbadSampleRows } from './simbad-sample-parse';

export const SIMBAD_SAMPLE = defineSource({
  file: 'data/simbad/simbad_sample.tsv',
  hint: 'Re-run `pnpm run refresh:simbad`.',
  parse: (input) => parseSimbadSampleRows(input.text(), input),
});

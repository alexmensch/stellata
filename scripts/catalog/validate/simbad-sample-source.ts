// The stratified SIMBAD cross-check sample, declared.

import { defineSource, type Declared } from '../../util/sources/source';
import { parseSimbadSampleRows } from './simbad-sample-parse';

const FROM: Declared = {
  file: 'data/simbad/simbad_sample.tsv',
  hint: 'Re-run `pnpm run refresh:simbad`.',
};

export const SIMBAD_SAMPLE = defineSource({
  ...FROM,
  parse: (input) => parseSimbadSampleRows(input.text(), FROM),
});

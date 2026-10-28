// SIMBAD bibcoded values over the per-field value cohort, declared.

import { defineSource } from '../../util/sources/source';
import { parseSimbadValuesTsv } from './simbad-values-parse';

export const SIMBAD_VALUES = defineSource({
  file: 'data/simbad/simbad_values.tsv',
  hint: 'Re-run `pnpm run refresh:simbad-values`.',
  parse: (input) => parseSimbadValuesTsv(input.text(), input),
});

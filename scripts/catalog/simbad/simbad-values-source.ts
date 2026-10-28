// SIMBAD bibcoded values over the per-field value cohort, declared.

import { defineSource, type Declared } from '../../util/sources/source';
import { parseSimbadValuesTsv } from './simbad-values-parse';

const FROM: Declared = {
  file: 'data/simbad/simbad_values.tsv',
  hint: 'Re-run `pnpm run refresh:simbad-values`.',
};

export const SIMBAD_VALUES = defineSource({
  ...FROM,
  parse: (input) => parseSimbadValuesTsv(input.text(), FROM),
});

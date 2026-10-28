// The IAU WGSN names table (NEC.csv), declared.

import { defineSource, type Declared } from '../../util/sources/source';
import { parseNecCsv } from './wgsn-parse-pure';

const FROM: Declared = {
  file: 'data/iau-wgsn/NEC.csv',
  hint: 'Re-run scripts/refresh/refresh-iau-wgsn.py.',
};

export const WGSN_NEC = defineSource({
  ...FROM,
  parse: (input) => parseNecCsv(input.text(), FROM),
});

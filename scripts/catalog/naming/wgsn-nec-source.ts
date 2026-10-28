// The IAU WGSN names table (NEC.csv), declared.

import { defineSource } from '../../util/sources/source';
import { parseNecCsv } from './wgsn-parse-pure';

export const WGSN_NEC = defineSource({
  file: 'data/iau-wgsn/NEC.csv',
  hint: 'Re-run scripts/refresh/refresh-iau-wgsn.py.',
  parse: (input) => parseNecCsv(input.text(), input),
});

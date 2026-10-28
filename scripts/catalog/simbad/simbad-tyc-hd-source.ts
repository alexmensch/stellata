// SIMBAD's TYC → HD attributions, declared.

import { defineSource } from '../../util/sources/source';
import { parseSimbadTycHdTsv } from './simbad-tyc-hd-parse';

export const SIMBAD_TYC_HD = defineSource({
  file: 'data/simbad/simbad_tyc_hd.tsv',
  hint: 'Re-run `python3 scripts/refresh/refresh-simbad-tyc-hd.py`.',
  parse: (input) => parseSimbadTycHdTsv(input.text(), input),
});

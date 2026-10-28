// SIMBAD's TYC → HD attributions, declared.

import { defineSource, type Declared } from '../../util/sources/source';
import { parseSimbadTycHdTsv } from './simbad-tyc-hd-parse';

const FROM: Declared = {
  file: 'data/simbad/simbad_tyc_hd.tsv',
  hint: 'Re-run `python3 scripts/refresh/refresh-simbad-tyc-hd.py`.',
};

export const SIMBAD_TYC_HD = defineSource({
  ...FROM,
  parse: (input) => parseSimbadTycHdTsv(input.text(), FROM),
});

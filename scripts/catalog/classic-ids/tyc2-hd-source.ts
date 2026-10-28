// IV/25, the Tycho-2 → HD cross-identification, declared.

import { defineSource, type Declared } from '../../util/sources/source';
import { parseTyc2HdTsv } from './classic-ids-parse';

const FROM: Declared = {
  file: 'data/classic-ids/tyc2_hd.tsv',
  hint: 'Refresh the CDS inputs with `pnpm run refresh:classic-ids`.',
};

export const TYC2_HD = defineSource({
  ...FROM,
  parse: (input) => parseTyc2HdTsv(input.text(), FROM),
});

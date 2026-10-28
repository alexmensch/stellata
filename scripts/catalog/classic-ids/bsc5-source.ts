// V/50, the Bright Star Catalogue, declared.

import { defineSource, type Declared } from '../../util/sources/source';
import { parseBsc5Tsv } from './classic-ids-parse';

const FROM: Declared = {
  file: 'data/classic-ids/bsc5.tsv',
  hint: 'Refresh the CDS inputs with `pnpm run refresh:classic-ids`.',
};

export const BSC5 = defineSource({
  ...FROM,
  parse: (input) => parseBsc5Tsv(input.text(), FROM),
});

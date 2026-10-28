// CNS5, declared.

import { defineSource, type Declared } from '../../util/sources/source';
import { parseCns5Tsv } from './classic-ids-parse';

const FROM: Declared = {
  file: 'data/classic-ids/cns5.tsv',
  hint: 'Re-run `pnpm run refresh:classic-ids`.',
};

export const CNS5 = defineSource({
  ...FROM,
  parse: (input) => parseCns5Tsv(input.text(), FROM),
});

// CNS5, declared.

import { defineSource } from '../../util/sources/source';
import { parseCns5Tsv } from './classic-ids-parse';

export const CNS5 = defineSource({
  file: 'data/classic-ids/cns5.tsv',
  hint: 'Re-run `pnpm run refresh:classic-ids`.',
  parse: (input) => parseCns5Tsv(input.text(), input),
});

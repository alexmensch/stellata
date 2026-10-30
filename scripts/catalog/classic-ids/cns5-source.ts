// CNS5, declared.

import { defineSource } from '../../util/sources/source';
import { parseCns5Tsv, type Cns5Row } from './classic-ids-parse';

export const CNS5 = defineSource({
  file: 'data/classic-ids/cns5.tsv',
  hint: 'Re-run `pnpm run refresh:classic-ids`.',
  rowKey: { id: 'cns5', text: (cns5: number) => String(cns5) },
  parse: (input): Cns5Row[] => parseCns5Tsv(input.text(), CNS5),
});

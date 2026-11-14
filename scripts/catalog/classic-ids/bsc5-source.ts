// V/50, the Bright Star Catalogue, declared.

import { defineSource } from '../../util/sources/source';
import { parseBsc5Tsv } from './classic-ids-parse';

export const BSC5 = defineSource({
  file: 'data/classic-ids/bsc5.tsv',
  hint: 'Refresh the CDS inputs with `pnpm run refresh:classic-ids`.',
  rowKey: { id: 'v50', text: (hr: number) => String(hr) },
  parse: (input) => parseBsc5Tsv(input.text(), input),
});

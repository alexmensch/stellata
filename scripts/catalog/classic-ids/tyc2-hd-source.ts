// IV/25, the Tycho-2 → HD cross-identification, declared.

import { defineSource } from '../../util/sources/source';
import { parseTyc2HdTsv } from './classic-ids-parse';

export const TYC2_HD = defineSource({
  file: 'data/classic-ids/tyc2_hd.tsv',
  hint: 'Refresh the CDS inputs with `pnpm run refresh:classic-ids`.',
  rowKey: { id: 'iv25', text: (tyc: string) => tyc },
  parse: (input) => parseTyc2HdTsv(input.text(), input),
});

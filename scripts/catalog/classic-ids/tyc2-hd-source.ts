// IV/25, the Tycho-2 → HD cross-identification, declared.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource } from '../../util/sources/source';
import { parseTyc2HdTsv } from './classic-ids-parse';

export const TYC2_HD = defineSource({
  file: DATA_FILES.tyc2Hd,
  hint: 'Refresh the CDS inputs with `pnpm run refresh:classic-ids`.',
  rowKey: { id: 'iv25', cardinality: 'one', text: (tyc: string) => tyc },
  parse: (input) => parseTyc2HdTsv(input.text(), input),
});

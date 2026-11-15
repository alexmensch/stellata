// V/50, the Bright Star Catalogue, declared.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource } from '../../util/sources/source';
import { parseBsc5Tsv } from './classic-ids-parse';

export const BSC5 = defineSource({
  file: DATA_FILES.bsc5,
  hint: 'Refresh the CDS inputs with `pnpm run refresh:classic-ids`.',
  rowKey: { id: 'v50', cardinality: 'one', text: (hr: number) => String(hr) },
  parse: (input) => parseBsc5Tsv(input.text(), input),
});

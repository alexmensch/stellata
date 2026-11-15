// CNS5, declared.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource } from '../../util/sources/source';
import { parseCns5Tsv, type Cns5Row } from './classic-ids-parse';

export const CNS5 = defineSource({
  file: DATA_FILES.cns5,
  hint: 'Re-run `pnpm run refresh:classic-ids`.',
  rowKey: { id: 'cns5', cardinality: 'one', text: (cns5: number) => String(cns5) },
  parse: (input): Cns5Row[] => parseCns5Tsv(input.text(), CNS5),
});

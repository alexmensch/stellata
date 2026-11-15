// IV/27A with its curated corrections applied, declared. See README.md#one-designation-two-hd-numbers.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource, type Declared } from '../../util/sources/source';
import {
  applyCrossIndexCorrections,
  parseCrossIndexCorrectionsTsv,
  parseCrossIndexTsv,
} from './classic-ids-parse';

const CORRECTIONS: Declared = {
  file: 'data/classic-ids/cross_index_corrections.tsv',
  hint: 'Restore it from the repo — it is hand-curated, not generated.',
};

export const CROSS_INDEX = defineSource({
  file: DATA_FILES.crossIndex,
  hint: 'Refresh the CDS inputs with `pnpm run refresh:classic-ids`.',
  members: [CORRECTIONS],
  rowKey: { id: 'iv27a', cardinality: 'one', text: (hd: number) => String(hd) },
  parse: (input) => {
    const [corrections] = input.members;
    return applyCrossIndexCorrections(
      parseCrossIndexTsv(input.text(), input),
      parseCrossIndexCorrectionsTsv(corrections.text(), corrections),
      corrections,
    );
  },
});

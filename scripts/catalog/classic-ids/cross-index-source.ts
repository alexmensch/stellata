// IV/27A with its curated corrections applied, declared. See README.md#one-designation-two-hd-numbers.

import { defineSource, openDeclared, type Declared } from '../../util/sources/source';
import {
  applyCrossIndexCorrections,
  parseCrossIndexCorrectionsTsv,
  parseCrossIndexTsv,
} from './classic-ids-parse';

const TABLE: Declared = {
  file: 'data/classic-ids/cross_index.tsv',
  hint: 'Refresh the CDS inputs with `pnpm run refresh:classic-ids`.',
};

const CORRECTIONS: Declared = {
  file: 'data/classic-ids/cross_index_corrections.tsv',
  hint: 'Restore it from the repo — it is hand-curated, not generated.',
};

export const CROSS_INDEX = defineSource({
  ...TABLE,
  members: [CORRECTIONS],
  parse: (input) => applyCrossIndexCorrections(
    parseCrossIndexTsv(input.text(), TABLE),
    parseCrossIndexCorrectionsTsv(openDeclared(CORRECTIONS).text(), CORRECTIONS),
    CORRECTIONS,
  ),
});

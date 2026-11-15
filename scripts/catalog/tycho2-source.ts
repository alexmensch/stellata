// Tycho-2 main and supplement 1, read together, declared.

import { DATA_FILES } from '../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource, type Declared } from '../util/sources/source';
import { parseTycho2Tsvs, type Tycho2Row } from './tycho2-parse';

const HINT = 'Re-run `pnpm run refresh:tycho2`.';
const SUPPL1: Declared = { file: DATA_FILES.tycho2Suppl1, hint: HINT };

export const TYCHO2 = defineSource({
  file: DATA_FILES.tycho2Main,
  hint: HINT,
  members: [SUPPL1],
  rowKey: { id: 'i259', cardinality: 'one', text: (tyc: string) => tyc },
  parse: (input): Map<string, Tycho2Row> => {
    const [suppl1] = input.members;
    return parseTycho2Tsvs(
      { text: input.text(), from: input }, { text: suppl1.text(), from: suppl1 }, TYCHO2,
    );
  },
});

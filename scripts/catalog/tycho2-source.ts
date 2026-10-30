// Tycho-2 main and supplement 1, read together, declared.

import { defineSource, type Declared } from '../util/sources/source';
import { parseTycho2Tsvs, type Tycho2Row } from './tycho2-parse';

const HINT = 'Re-run `pnpm run refresh:tycho2`.';
const SUPPL1: Declared = { file: 'data/tycho2/tycho2_suppl1.tsv', hint: HINT };

export const TYCHO2 = defineSource({
  file: 'data/tycho2/tycho2_main.tsv',
  hint: HINT,
  members: [SUPPL1],
  rowKey: { id: 'i259', text: (tyc: string) => tyc },
  parse: (input): Map<string, Tycho2Row> => {
    const [suppl1] = input.members;
    return parseTycho2Tsvs(
      { text: input.text(), from: input }, { text: suppl1.text(), from: suppl1 }, TYCHO2,
    );
  },
});

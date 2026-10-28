// Tycho-2 main and supplement 1, read together, declared.

import { defineSource, openDeclared, type Declared } from '../util/sources/source';
import { parseTycho2Tsvs } from './tycho2-parse';

const HINT = 'Re-run `pnpm run refresh:tycho2`.';
const MAIN: Declared = { file: 'data/tycho2/tycho2_main.tsv', hint: HINT };
const SUPPL1: Declared = { file: 'data/tycho2/tycho2_suppl1.tsv', hint: HINT };

export const TYCHO2 = defineSource({
  ...MAIN,
  members: [SUPPL1],
  parse: (input) => parseTycho2Tsvs(
    { text: input.text(), from: MAIN },
    { text: openDeclared(SUPPL1).text(), from: SUPPL1 },
  ),
});

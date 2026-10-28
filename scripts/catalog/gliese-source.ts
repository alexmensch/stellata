// Gliese & Jahreiss 1991 (V/70A), declared.

import { defineSource, type Declared } from '../util/sources/source';
import { parseGlieseTsv } from './gliese-parse';

const FROM: Declared = {
  file: 'data/gliese/gliese_v70a.tsv',
  hint: 'Re-run `pnpm run refresh:gliese`.',
};

export const GLIESE = defineSource({
  ...FROM,
  parse: (input) => parseGlieseTsv(input.text(), FROM),
});

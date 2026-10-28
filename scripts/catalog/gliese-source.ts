// Gliese & Jahreiss 1991 (V/70A), declared.

import { defineSource } from '../util/sources/source';
import { parseGlieseTsv } from './gliese-parse';

export const GLIESE = defineSource({
  file: 'data/gliese/gliese_v70a.tsv',
  hint: 'Re-run `pnpm run refresh:gliese`.',
  parse: (input) => parseGlieseTsv(input.text(), input),
});

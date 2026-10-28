// The sol: and shell: namespace mint lists, declared.

import { defineSource } from '../util/sources/source';
import { parseShellObjectsTsv, parseSolObjectsTsv } from './sid-pure';

const HINT = 'The mint list is curated under data/sid/.';
export const SOL_OBJECTS = defineSource({
  file: 'data/sid/sol-objects.tsv',
  hint: HINT,
  parse: (input) => parseSolObjectsTsv(input.text(), input),
});

export const SHELL_OBJECTS = defineSource({
  file: 'data/sid/shell-objects.tsv',
  hint: HINT,
  parse: (input) => parseShellObjectsTsv(input.text(), input),
});

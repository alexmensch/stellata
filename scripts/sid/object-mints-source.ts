// The sol: and shell: namespace mint lists, declared.

import { defineSource, type Declared } from '../util/sources/source';
import { parseShellObjectsTsv, parseSolObjectsTsv } from './sid-pure';

const HINT = 'The mint list is curated under data/sid/.';
const SOL_FROM: Declared = { file: 'data/sid/sol-objects.tsv', hint: HINT };
const SHELL_FROM: Declared = { file: 'data/sid/shell-objects.tsv', hint: HINT };

export const SOL_OBJECTS = defineSource({
  ...SOL_FROM,
  parse: (input) => parseSolObjectsTsv(input.text(), SOL_FROM),
});

export const SHELL_OBJECTS = defineSource({
  ...SHELL_FROM,
  parse: (input) => parseShellObjectsTsv(input.text(), SHELL_FROM),
});

// The sol: and shell: namespace mint lists, declared and keyed on their rows' key cell.

import { defineSource } from '../util/sources/source';
import { parseShellObjectsTsv, parseSolObjectsTsv, type SolObjectRow } from './sid-pure';

const HINT = 'The mint list is curated under data/sid/.';
export const SOL_OBJECTS = defineSource({
  file: 'data/sid/sol-objects.tsv',
  hint: HINT,
  parse: (input) => parseSolObjectsTsv(input.text(), input),
  rowKey: { id: 'sol-objects', text: (row: Pick<SolObjectRow, 'key'>) => row.key },
});

export const SHELL_OBJECTS = defineSource({
  file: 'data/sid/shell-objects.tsv',
  hint: HINT,
  parse: (input) => parseShellObjectsTsv(input.text(), input),
  rowKey: { id: 'shell-objects', text: (row: Pick<SolObjectRow, 'key'>) => row.key },
});

// AT-HYG v3.3's classic-ID CSV, declared: each reader names the columns it takes.

import { defineSource } from '../../util/sources/source';
import { readTable, type TableRow } from '../../util/tsv/table-pure';

export type AthygTable = <C extends string>(columns: readonly C[]) => Generator<TableRow<C>>;

export const ATHYG_CLASSIC_IDS = defineSource({
  file: 'data/athyg/athyg_33_classic_ids.csv',
  hint: 'It is frozen; restore it from git rather than regenerating it.',
  parse: (input): AthygTable => {
    const text = input.text();
    return (columns) => readTable({ file: input.file, hint: input.hint, columns, csv: true }, text);
  },
});

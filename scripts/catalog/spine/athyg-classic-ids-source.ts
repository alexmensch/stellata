// AT-HYG v3.3's classic-ID CSV, declared: each reader names the columns it takes.

import { defineSource } from '../../util/sources/source';
import { columnTable } from '../../util/tsv/table-pure';

export const ATHYG_CLASSIC_IDS = defineSource({
  file: 'data/athyg/athyg_33_classic_ids.csv',
  hint: 'It is frozen; restore it from git rather than regenerating it.',
  parse: (input) => columnTable({ file: input.file, hint: input.hint, csv: true }, input.text()),
});

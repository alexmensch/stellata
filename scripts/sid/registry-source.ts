// The SID registry's hand-appended retirement and reinstatement files, declared.

import { defineSource } from '../util/sources/source';
import { reinstatementsFile, retirementsFile } from './sid-pure';

const HINT = 'It is hand-appended: restore the row (/docs/sid.md#43-ledger--datasidledgertsv).';
export const RETIREMENTS = defineSource({
  file: 'data/sid/retirements.tsv',
  hint: HINT,
  parse: (input) => retirementsFile(input.text(), input),
});

export const REINSTATEMENTS = defineSource({
  file: 'data/sid/reinstatements.tsv',
  hint: HINT,
  parse: (input) => reinstatementsFile(input.text(), input),
});

// The SID registry's hand-appended retirement and reinstatement files, declared.

import { defineSource, type Declared } from '../util/sources/source';
import { reinstatementsFile, retirementsFile } from './sid-pure';

const HINT = 'It is hand-appended: restore the row (/docs/sid.md#43-ledger--datasidledgertsv).';
const RETIREMENTS_FROM: Declared = { file: 'data/sid/retirements.tsv', hint: HINT };
const REINSTATEMENTS_FROM: Declared = { file: 'data/sid/reinstatements.tsv', hint: HINT };

export const RETIREMENTS = defineSource({
  ...RETIREMENTS_FROM,
  parse: (input) => retirementsFile(input.text(), RETIREMENTS_FROM),
});

export const REINSTATEMENTS = defineSource({
  ...REINSTATEMENTS_FROM,
  parse: (input) => reinstatementsFile(input.text(), REINSTATEMENTS_FROM),
});

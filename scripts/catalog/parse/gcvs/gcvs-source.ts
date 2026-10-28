// The GCVS main table and its cross-identification list, declared.

import { defineSource } from '../../../util/sources/source';
import { parseGcvsCrossref, parseGcvsMain } from './gcvs-parse';

const HINT = 'They are frozen: restore them from the repo (data/gcvs/README.md).';

export const GCVS = defineSource({
  file: 'data/gcvs/gcvs5.txt',
  hint: HINT,
  parse: (input) => parseGcvsMain(input.text()),
});

export const GCVS_CROSSID = defineSource({
  file: 'data/gcvs/crossid.txt',
  hint: HINT,
  parse: (input) => parseGcvsCrossref(input.text()),
});

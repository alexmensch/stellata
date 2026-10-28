// The IAU WGSN faint-star names (wgsnFaints.csv) with their curated cell corrections applied, declared.
// See README.md#files-in-this-area.

import { defineSource, openDeclared, type Declared } from '../../util/sources/source';
import { parseFaintsCorrections, parseWgsnFaintsCsv } from './wgsn-parse-pure';

const CORRECTIONS: Declared = {
  file: 'data/iau-wgsn/wgsn_faints_corrections.tsv',
  hint: 'It is hand-curated; see /data/iau-wgsn/README.md#upstream-quirks-the-pipeline-handles.',
};

export const WGSN_FAINTS = defineSource({
  file: 'data/iau-wgsn/wgsnFaints.csv',
  hint: 'Re-run scripts/refresh/refresh-iau-wgsn.py.',
  members: [CORRECTIONS],
  parse: (input) => parseWgsnFaintsCsv(input.text(), input, {
    sets: parseFaintsCorrections(openDeclared(CORRECTIONS).text(), CORRECTIONS),
    file: CORRECTIONS.file,
  }),
});

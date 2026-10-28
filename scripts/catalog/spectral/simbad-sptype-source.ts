// SIMBAD sp_type under all four namespaces, declared.

import { defineSource, type Declared } from '../../util/sources/source';
import { parseSimbadSptypeTsv } from './spectral-resolve';

const FROM: Declared = {
  file: 'data/simbad/simbad_sptype.tsv',
  hint: 'Re-run scripts/refresh/refresh-simbad-sptype.py.',
};

export const SIMBAD_SPTYPE = defineSource({
  ...FROM,
  parse: (input) => parseSimbadSptypeTsv(input.text(), FROM),
});

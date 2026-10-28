// SIMBAD sp_type under all four namespaces, declared.

import { defineSource } from '../../util/sources/source';
import { parseSimbadSptypeTsv } from './spectral-resolve';

export const SIMBAD_SPTYPE = defineSource({
  file: 'data/simbad/simbad_sptype.tsv',
  hint: 'Re-run scripts/refresh/refresh-simbad-sptype.py.',
  parse: (input) => parseSimbadSptypeTsv(input.text(), input),
});

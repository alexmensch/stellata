// SIMBAD sp_type under all four namespaces, declared.

import { defineSource } from '../../util/sources/source';
import { parseSimbadSptypeTsv, type SimbadSptype } from './spectral-resolve';

export const SIMBAD_SPTYPE = defineSource({
  file: 'data/simbad/simbad_sptype.tsv',
  hint: 'Re-run scripts/refresh/refresh-simbad-sptype.py.',
  rowKey: { id: 'simbad-sptype', text: (oid: number) => String(oid) },
  parse: (input): SimbadSptype => parseSimbadSptypeTsv(input.text(), SIMBAD_SPTYPE),
});

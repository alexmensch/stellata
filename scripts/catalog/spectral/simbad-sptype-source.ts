// SIMBAD sp_type under all four namespaces, declared.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource } from '../../util/sources/source';
import { parseSimbadSptypeTsv, type SimbadSptype } from './spectral-resolve';

export const SIMBAD_SPTYPE = defineSource({
  file: DATA_FILES.simbadSptype,
  hint: 'Re-run `pnpm run refresh:simbad-sptype`.',
  rowKey: { id: 'simbad-sptype', text: (oid: number) => String(oid) },
  parse: (input): SimbadSptype => parseSimbadSptypeTsv(input.text(), SIMBAD_SPTYPE),
});

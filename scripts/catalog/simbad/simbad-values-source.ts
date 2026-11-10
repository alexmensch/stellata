// SIMBAD bibcoded values over the per-field value cohort, declared.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource } from '../../util/sources/source';
import { parseSimbadValuesTsv, type SimbadValueIndex } from './simbad-values-parse';

export const SIMBAD_VALUES = defineSource({
  file: DATA_FILES.simbadValues,
  hint: 'Re-run `pnpm run refresh:simbad-values`.',
  rowKey: { id: 'simbad', text: (oid: number) => String(oid) },
  parse: (input): SimbadValueIndex => parseSimbadValuesTsv(input.text(), SIMBAD_VALUES),
});

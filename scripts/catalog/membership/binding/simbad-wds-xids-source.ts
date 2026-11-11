// SIMBAD's WDS component cross-IDs, declared: one table its three readers take columns from.

import { DATA_FILES } from '../../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource } from '../../../util/sources/source';
import { columnTable } from '../../../util/tsv/table-pure';

export const SIMBAD_WDS_XIDS = defineSource({
  file: DATA_FILES.simbadWdsXids,
  hint: 'Run `pnpm run refresh:simbad-wds-xids`.',
  parse: (input) => columnTable({ file: input.file, hint: input.hint }, input.text()),
});

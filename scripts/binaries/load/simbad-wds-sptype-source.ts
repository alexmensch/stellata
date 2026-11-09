// SIMBAD's sp_type for every WDS cross-ID object (refresh:simbad-wds-sptype's table), declared.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource } from '../../util/sources/source';
import { parseSptypeByOid } from './simbad-pure';

export const SIMBAD_WDS_SPTYPE = defineSource({
  file: DATA_FILES.simbadWdsSptype,
  hint: 'Re-run `pnpm run refresh:simbad-wds-sptype`.',
  parse: (input) => parseSptypeByOid(input.text(), input),
});

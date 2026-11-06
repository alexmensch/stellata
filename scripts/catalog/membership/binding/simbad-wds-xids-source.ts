// SIMBAD's WDS component cross-IDs, declared.

import { DATA_FILES } from '../../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource } from '../../../util/sources/source';
import { parseSimbadWdsXidsTsv } from './binding-gate-pure';

export const SIMBAD_WDS_XIDS = defineSource({
  file: DATA_FILES.simbadWdsXids,
  hint: 'Re-run `python3 scripts/refresh/refresh-simbad-wds-xids.py`.',
  parse: (input) => parseSimbadWdsXidsTsv(input.text(), input),
});

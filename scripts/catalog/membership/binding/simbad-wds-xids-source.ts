// SIMBAD's WDS component cross-IDs, declared.

import { defineSource } from '../../../util/sources/source';
import { parseSimbadWdsXidsTsv } from './binding-gate-pure';

export const SIMBAD_WDS_XIDS = defineSource({
  file: 'data/simbad/simbad_wds_xids.tsv',
  hint: 'Re-run `python3 scripts/refresh/refresh-simbad-wds-xids.py`.',
  parse: (input) => parseSimbadWdsXidsTsv(input.text(), input),
});

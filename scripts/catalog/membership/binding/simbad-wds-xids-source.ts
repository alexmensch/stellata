// SIMBAD's WDS component cross-IDs, declared.

import { defineSource, type Declared } from '../../../util/sources/source';
import { parseSimbadWdsXidsTsv } from './binding-gate-pure';

const FROM: Declared = {
  file: 'data/simbad/simbad_wds_xids.tsv',
  hint: 'Re-run `python3 scripts/refresh/refresh-simbad-wds-xids.py`.',
};

export const SIMBAD_WDS_XIDS = defineSource({
  ...FROM,
  parse: (input) => parseSimbadWdsXidsTsv(input.text(), FROM),
});

// The hand-curated WDS-component oid overrides, declared.

import { defineSource } from '../../util/sources/source';
import { parseWdsXidsOverrides } from './wds-xids-overrides-pure';

export const WDS_XIDS_OVERRIDES = defineSource({
  file: 'data/simbad/wds_xids_overrides.tsv',
  hint: 'It is hand-curated: correct the row (/scripts/refresh/simbad-wds-xids/README.md#overrides).',
  parse: (input) => parseWdsXidsOverrides(input.text(), input),
});

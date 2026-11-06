// The SIMBAD oids simbad_wds_xids.tsv binds WDS components to, declared.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource } from '../../util/sources/source';
import { wdsOids } from './simbad-wds-sptype-pure';

export const SIMBAD_WDS_OIDS = defineSource({
  file: DATA_FILES.simbadWdsXids,
  hint: 'Run `pnpm run refresh:simbad-wds-xids`.',
  parse: (input) => wdsOids(input.text(), input),
});

// The oids simbad_sptype.tsv resolved the manifest to, declared: refresh:simbad-idents' request. See README.md#the-request.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource } from '../../util/sources/source';
import { sptypeOids } from './simbad-idents-pure';

export const SPTYPE_OIDS = defineSource({
  file: DATA_FILES.simbadSptype,
  hint: 'Re-run `pnpm run refresh:simbad-sptype`.',
  parse: (input): number[] => sptypeOids(input.text()),
});

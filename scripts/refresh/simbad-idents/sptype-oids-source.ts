// The oids simbad_sptype.tsv resolved the manifest to, declared: refresh:simbad-idents' request. See README.md#the-request.

import { SIMBAD_SPTYPE } from '../../catalog/spectral/simbad-sptype-source';
import { defineSource } from '../../util/sources/source';
import { sptypeOids } from './simbad-idents-pure';

export const SPTYPE_OIDS = defineSource({
  file: SIMBAD_SPTYPE.file,
  hint: SIMBAD_SPTYPE.hint,
  parse: (input): number[] => sptypeOids(input.text(), SPTYPE_OIDS),
});

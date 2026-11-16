// SIMBAD's designation idents per object, declared, and their Flamsteed numbers classified against IV/27A.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import type { CrossIndexRow } from '../classic-ids/classic-ids-parse';
import { defineSource } from '../../util/sources/source';
import { classifySimbadFlamsteed, type SimbadFlamsteed } from './simbad-flamsteed-pure';
import { parseSimbadIdentsTsv } from './simbad-idents-parse';

export const SIMBAD_IDENTS = defineSource({
  file: DATA_FILES.simbadIdents,
  hint: 'Re-run `pnpm run refresh:simbad-idents`.',
  parse: (input) => parseSimbadIdentsTsv(input.text(), input),
});

export function readSimbadFlamsteed(crossIndex: readonly CrossIndexRow[]): SimbadFlamsteed {
  return classifySimbadFlamsteed(SIMBAD_IDENTS.read(), crossIndex);
}

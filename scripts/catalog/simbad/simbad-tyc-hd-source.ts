// SIMBAD's TYC → HD attributions, declared.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource } from '../../util/sources/source';
import { parseSimbadTycHdTsv } from './simbad-tyc-hd-parse';

export const SIMBAD_TYC_HD = defineSource({
  file: DATA_FILES.simbadTycHd,
  hint: 'Re-run `pnpm run refresh:simbad-tyc-hd`.',
  parse: (input) => parseSimbadTycHdTsv(input.text(), input),
});

// Printed Hipparcos V and B−V (the I/239 slice), declared.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource } from '../../util/sources/source';
import { parseHipPhotometryTsv, type HipPhotometryTables } from './hip-photometry-parse-pure';

export const HIP_PHOTOMETRY = defineSource({
  file: DATA_FILES.hipMainVmag,
  hint: 'Re-run `pnpm run refresh:hip-vmag`.',
  rowKey: { id: 'i239', cardinality: 'one', text: (hip: number) => String(hip) },
  parse: (input): HipPhotometryTables => parseHipPhotometryTsv(input.text(), HIP_PHOTOMETRY),
});

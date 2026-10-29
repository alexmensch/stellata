// Printed Hipparcos V and B−V (the I/239 slice), declared.

import { defineSource } from '../../util/sources/source';
import { parseHipPhotometryTsv } from './hip-photometry-parse';

export const HIP_PHOTOMETRY = defineSource({
  file: 'data/hipparcos/hip_main_vmag.tsv',
  hint: 'Re-run `pnpm run refresh:hip-vmag`.',
  rowKey: { id: 'i239', text: (hip: number) => String(hip) },
  parse: (input) => parseHipPhotometryTsv(input.text(), input),
});

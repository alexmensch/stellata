// Printed Hipparcos V and B−V (the I/239 slice), declared.

import { defineSource, type Declared } from '../../util/sources/source';
import { parseHipPhotometryTsv } from './hip-photometry-parse';

const FROM: Declared = {
  file: 'data/hipparcos/hip_main_vmag.tsv',
  hint: 'Re-run `pnpm run refresh:hip-vmag`.',
};

export const HIP_PHOTOMETRY = defineSource({
  ...FROM,
  parse: (input) => parseHipPhotometryTsv(input.text(), FROM),
});

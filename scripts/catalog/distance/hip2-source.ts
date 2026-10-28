// HIP2 (van Leeuwen 2007) astrometry, declared.

import { defineSource, type Declared } from '../../util/sources/source';
import { parseHip2Tsv } from './direction-cascade';

const FROM: Declared = {
  file: 'data/hipparcos/hip2_van_leeuwen.tsv',
  hint: 'Re-run `pnpm run refresh:hip2`.',
};

export const HIP2 = defineSource({
  ...FROM,
  parse: (input) => parseHip2Tsv(input.text(), FROM),
});

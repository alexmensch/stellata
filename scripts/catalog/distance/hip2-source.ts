// HIP2 (van Leeuwen 2007) astrometry, declared.

import { defineSource } from '../../util/sources/source';
import { parseHip2Tsv } from './direction-cascade';

export const HIP2 = defineSource({
  file: 'data/hipparcos/hip2_van_leeuwen.tsv',
  hint: 'Re-run `pnpm run refresh:hip2`.',
  parse: (input) => parseHip2Tsv(input.text(), input),
});

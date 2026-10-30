// HIP2 (van Leeuwen 2007) astrometry, declared.

import { defineSource } from '../../util/sources/source';
import { parseHip2Tsv, type Hip2Table } from './direction-cascade';

export const HIP2 = defineSource({
  file: 'data/hipparcos/hip2_van_leeuwen.tsv',
  hint: 'Re-run `pnpm run refresh:hip2`.',
  rowKey: { id: 'i311', text: (hip: number) => String(hip) },
  parse: (input): Hip2Table => parseHip2Tsv(input.text(), HIP2),
});

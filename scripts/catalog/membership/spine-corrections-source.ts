// The curated spine merge-decision corrections, declared.

import { defineSource } from '../../util/sources/source';
import { parseSpineCorrectionsTsv } from './membership-manifest-pure';

export const SPINE_CORRECTIONS = defineSource({
  file: 'data/membership/spine-corrections.tsv',
  hint: 'It is committed and hand-curated (README.md#correcting-a-merge-decision).',
  parse: (input) => parseSpineCorrectionsTsv(input.text(), input),
});

// The curated spine merge-decision corrections, declared.

import { defineSource, type Declared } from '../../util/sources/source';
import { parseSpineCorrectionsTsv } from './membership-manifest-pure';

const FROM: Declared = {
  file: 'data/membership/spine-corrections.tsv',
  hint: 'It is committed and hand-curated (README.md#correcting-a-merge-decision).',
};

export const SPINE_CORRECTIONS = defineSource({
  ...FROM,
  parse: (input) => parseSpineCorrectionsTsv(input.text(), FROM),
});

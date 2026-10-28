// The binding review queue's dispositions, declared.

import { defineSource, type Declared } from '../../util/sources/source';
import { parseBindingDispositionsTsv } from './membership-manifest-pure';

const FROM: Declared = {
  file: 'data/membership/binding-review-dispositions.tsv',
  hint: 'It is committed and hand-curated: dispose every row of binding-review.tsv there (README.md#the-spine-side).',
};

export const BINDING_REVIEW_DISPOSITIONS = defineSource({
  ...FROM,
  parse: (input) => parseBindingDispositionsTsv(input.text(), FROM),
});

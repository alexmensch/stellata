// The binding review queue's dispositions, declared.

import { defineSource } from '../../util/sources/source';
import { parseBindingDispositionsTsv } from './membership-manifest-pure';

export const BINDING_REVIEW_DISPOSITIONS = defineSource({
  file: 'data/membership/binding-review-dispositions.tsv',
  hint: 'It is committed and hand-curated: dispose every row of binding-review.tsv there (README.md#the-spine-side).',
  parse: (input) => parseBindingDispositionsTsv(input.text(), input),
});

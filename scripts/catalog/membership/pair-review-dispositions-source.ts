// The pair-review queue's dispositions, declared.

import { defineSource } from '../../util/sources/source';
import { parsePairDispositionsTsv } from './pair-review-dispositions-pure';

export const PAIR_REVIEW_DISPOSITIONS = defineSource({
  file: 'data/membership/pair-review-dispositions.tsv',
  hint: 'It is committed and hand-curated: dispose rows of pair-review.tsv there (merge-derivation/README.md#disposing-a-queued-pair).',
  parse: (input) => parsePairDispositionsTsv(input.text(), input),
});

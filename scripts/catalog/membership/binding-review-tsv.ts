// Codec for data/membership/binding-review.tsv. See binding/README.md.

import { byText, defineArtifact } from '../../util/tsv/artifact-pure';
import { compareSourceIds } from '../../util/tsv/table-pure';
import {
  BINDING_REVIEW_COLUMNS,
  BINDING_REVIEW_VERDICTS,
  bindingReviewKey,
  type BindingReviewRow,
} from './ledger-rows-pure';

export const BINDING_REVIEW_FILE = 'data/membership/binding-review.tsv';

const byVerdict = byText((r: BindingReviewRow) => r.verdict);
const byKey = byText(bindingReviewKey);

export const BINDING_REVIEW = defineArtifact({
  file: BINDING_REVIEW_FILE,
  columns: BINDING_REVIEW_COLUMNS,
  hint: 'Re-run `pnpm run build:membership`.',
  order: (a: BindingReviewRow, b: BindingReviewRow) => compareSourceIds(a.derived_source_id, b.derived_source_id)
    || byVerdict(a, b) || byKey(a, b),
  decode: (row): BindingReviewRow => {
    row.oneOf('verdict', BINDING_REVIEW_VERDICTS);
    row.sourceId('derived_source_id');
    return row.cells();
  },
  encode: (r) => r,
});

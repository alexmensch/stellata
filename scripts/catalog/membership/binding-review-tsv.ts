// Codec for data/membership/binding-review.tsv. See binding/README.md.

import { byText, defineArtifact } from '../../util/tsv/artifact-pure';
import { compareSourceIds } from '../../util/tsv/table-pure';

export const BINDING_REVIEW_FILE = 'data/membership/binding-review.tsv';
export const BINDING_REVIEW_VERDICTS = ['contested', 'collision', 'disposed'] as const;
export type BindingReviewVerdict = (typeof BINDING_REVIEW_VERDICTS)[number];
export const BINDING_REVIEW_KEY_COLUMNS = ['tyc', 'hip', 'hd', 'gl'] as const;

/** The record a queue row and its disposition join on. */
export function bindingReviewKey(
  row: Record<(typeof BINDING_REVIEW_KEY_COLUMNS)[number], string>,
): string {
  return BINDING_REVIEW_KEY_COLUMNS.map((c) => row[c]).join('|');
}

export const BINDING_REVIEW_COLUMNS = [
  'tyc', 'hip', 'hd', 'hr', 'gl', 'verdict', 'derived_source_id',
  'derived_via', 'candidates', 'rejected', 'v_mag', 'v_via', 'derived_g',
  'derived_simbad',
] as const;
export type BindingReviewRow = Record<(typeof BINDING_REVIEW_COLUMNS)[number], string>;

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

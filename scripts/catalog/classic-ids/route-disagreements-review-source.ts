// The hand disposition of every HD/HIP route-disagreement queue row, declared.

import { defineSource } from '../../util/sources/source';
import { readTable } from '../../util/tsv/table-pure';

export interface RouteDisagreementReview {
  /** `<hd>\t<hip>`, the queue row it disposes. */
  key: string;
  verdict: string;
  note: string | null;
}

export const ROUTE_DISAGREEMENTS_REVIEW = defineSource({
  file: 'data/classic-ids/hd_hip_route_disagreements_review.tsv',
  hint: 'Dispose the row in hd_hip_route_disagreements_review.tsv.',
  parse: (input): RouteDisagreementReview[] =>
    [...readTable({ ...input, columns: ['hd', 'hip', 'verdict', 'note'] as const }, input.text())].map((row) => ({
      key: `${row.raw('hd')}\t${row.raw('hip')}`,
      verdict: row.raw('verdict'),
      note: row.text('note'),
    })),
});

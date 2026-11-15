// Codec for data/membership/pair-review.tsv. See merge-derivation/README.md#the-pair-review-queue.

import { defineArtifact } from '../../util/tsv/artifact-pure';
import { recordKeyCells, rowRecordIdentifiers } from '../lineage/identity/identity-pure';
import { PAIR_REVIEW_COLUMNS, PAIR_REVIEW_REASONS, type PairReviewRow } from './ledger-rows-pure';
import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';

export const PAIR_REVIEW = defineArtifact({
  file: DATA_FILES.pairReview,
  columns: PAIR_REVIEW_COLUMNS,
  hint: 'Re-run `pnpm run build:membership`.',
  order: 'by-line',
  decode: (row): PairReviewRow => ({
    ...rowRecordIdentifiers(row),
    entries: row.requiredText('entries').split('|'),
    reason: row.oneOf('reason', PAIR_REVIEW_REASONS),
  }),
  encode: (r) => ({ ...recordKeyCells(r), entries: r.entries.join('|'), reason: r.reason }),
});

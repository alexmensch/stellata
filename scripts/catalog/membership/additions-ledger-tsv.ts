// Codec for data/membership/additions-ledger.tsv. See README.md#the-additions.

import { isValidDesignation } from '../../sid/sid-pure';
import { defineArtifact } from '../../util/tsv/artifact-pure';

export const ADDITIONS_LEDGER_FILE = 'data/membership/additions-ledger.tsv';

/** The record-parity reason enum (/docs/catalog-driver.md#61-record-parity) for records the primaries admit that the spine lacked. */
export const ADDITION_REASONS = [
  'admitted:hd_link_gap',
  'admitted:hd_omitted',
  'admitted:hip_omitted',
  'admitted:cns5_census',
] as const;
export type AdditionReason = (typeof ADDITION_REASONS)[number];

/** A primary's row whose every designation a spine record already answers to,
 *  so admitting it would make that record's SID key ambiguous. Ledgered onto
 *  the record it resolves to rather than admitted; the suffix is that record's
 *  designation. */
export const COMPONENT_REASON_PREFIX = 'component:';

function isLedgerReason(reason: string): boolean {
  if (reason.startsWith(COMPONENT_REASON_PREFIX)) {
    return isValidDesignation(reason.slice(COMPONENT_REASON_PREFIX.length));
  }
  return (ADDITION_REASONS as readonly string[]).includes(reason);
}

export const LEDGER_COLUMNS = ['tyc', 'hip', 'hd', 'gl', 'gaia_source_id', 'reason'] as const;
export type AdditionLedgerRow = Record<(typeof LEDGER_COLUMNS)[number], string>;

export const ADDITIONS_LEDGER = defineArtifact({
  file: ADDITIONS_LEDGER_FILE,
  columns: LEDGER_COLUMNS,
  hint: 'Re-run `pnpm run build:membership`.',
  order: 'by-line',
  decode: (row): AdditionLedgerRow => {
    row.sourceId('gaia_source_id');
    const reason = row.raw('reason');
    if (!isLedgerReason(reason)) {
      row.fail(`reason "${reason}" is not one of ${ADDITION_REASONS.join(' | ')} | ${COMPONENT_REASON_PREFIX}<designation>`);
    }
    return row.cells();
  },
  encode: (r) => r,
});

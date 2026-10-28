// Codec for data/membership/additions-ledger.tsv. See README.md#the-additions.

import { isValidDesignation } from '../../sid/sid-pure';
import { defineArtifact } from '../../util/tsv/artifact-pure';
import {
  ADDITION_REASONS,
  COMPONENT_REASON_PREFIX,
  LEDGER_COLUMNS,
  type AdditionLedgerRow,
} from './ledger-rows-pure';

export const ADDITIONS_LEDGER_FILE = 'data/membership/additions-ledger.tsv';

function isLedgerReason(reason: string): boolean {
  if (reason.startsWith(COMPONENT_REASON_PREFIX)) {
    return isValidDesignation(reason.slice(COMPONENT_REASON_PREFIX.length));
  }
  return (ADDITION_REASONS as readonly string[]).includes(reason);
}

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

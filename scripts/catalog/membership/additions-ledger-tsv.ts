// Codec for data/membership/additions-ledger.tsv. See additions/README.md.

import { isValidDesignation } from '../../sid/sid-pure';
import { defineArtifact } from '../../util/tsv/artifact-pure';
import { recordKeyCells, rowRecordIdentifiers } from '../lineage/identity-pure';
import {
  ADDITION_REASONS,
  COMPONENT_REASON_PREFIX,
  LEDGER_COLUMNS,
  type AdditionLedgerRow,
} from './ledger-rows-pure';
import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';

function isLedgerReason(reason: string): reason is AdditionLedgerRow['reason'] {
  if (reason.startsWith(COMPONENT_REASON_PREFIX)) {
    return isValidDesignation(reason.slice(COMPONENT_REASON_PREFIX.length));
  }
  return (ADDITION_REASONS as readonly string[]).includes(reason);
}

export const ADDITIONS_LEDGER = defineArtifact({
  file: DATA_FILES.additionsLedger,
  columns: LEDGER_COLUMNS,
  hint: 'Re-run `pnpm run build:membership`.',
  order: 'by-line',
  decode: (row): AdditionLedgerRow => {
    const reason = row.raw('reason');
    if (!isLedgerReason(reason)) {
      return row.fail(`reason "${reason}" is not one of ${ADDITION_REASONS.join(' | ')} | ${COMPONENT_REASON_PREFIX}<designation>`);
    }
    return { ...rowRecordIdentifiers(row), reason };
  },
  encode: (r) => ({ ...recordKeyCells(r), reason: r.reason }),
});

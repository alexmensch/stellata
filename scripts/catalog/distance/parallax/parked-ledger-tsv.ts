// The record-parity dropped list's committed codec, beside the additions ledger it is the counterpart to.

import { defineArtifact } from '../../../util/tsv/artifact-pure';
import {
  PARKED_REASONS, parkedRecordKey, type ParkedLedgerEntry, type ParkedReason,
} from './parked-ledger-pure';
import { RECORD_KEY_COLUMNS, recordKeyCells, rowRecordIdentifiers } from '../../lineage/identity-pure';
import { DATA_FILES } from '../../../../src/catalog-format/pipeline-outputs/data-files';

/** Sorted on the whole row, not on `tyc` alone: a park with no TYC would tie
 *  with every other and leave the file's order a function of the walk. */
export const PARKED_LEDGER = defineArtifact({
  file: DATA_FILES.parkedLedger,
  columns: [...RECORD_KEY_COLUMNS, 'reason'] as const,
  hint: 'Re-run `pnpm run build:catalog`.',
  order: 'by-line',
  decode: (row): ParkedLedgerEntry => ({
    ...rowRecordIdentifiers(row),
    reason: row.oneOf('reason', PARKED_REASONS),
  }),
  encode: (e: ParkedLedgerEntry) => ({ ...recordKeyCells(e), reason: e.reason }),
});

export interface ParkedLedgerRow {
  recordKey: string;
  reason: ParkedReason;
}

export function parseParkedRecordsTsv(text: string): ParkedLedgerRow[] {
  return PARKED_LEDGER.parse(text).map((e) => ({
    recordKey: parkedRecordKey(PARKED_LEDGER.encode(e)),
    reason: e.reason,
  }));
}

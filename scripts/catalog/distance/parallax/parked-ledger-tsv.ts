// The record-parity dropped list's committed codec, beside the additions ledger it is the counterpart to.

import { defineArtifact, nullableCell } from '../../../util/tsv/artifact-pure';
import {
  PARKED_REASONS, parkedRecordKey, type ParkedLedgerEntry, type ParkedReason,
} from './parked-ledger';

/** Sorted on the whole row, not on `tyc` alone: a park with no TYC would tie
 *  with every other and leave the file's order a function of the walk. */
export const PARKED_LEDGER = defineArtifact({
  file: 'data/membership/parked-ledger.tsv',
  columns: ['tyc', 'hip', 'hd', 'gl', 'gaia_source_id', 'reason'] as const,
  hint: 'Re-run `pnpm run build:catalog`.',
  order: 'by-line',
  decode: (row): ParkedLedgerEntry => ({
    tyc: row.text('tyc'),
    hip: row.int('hip'),
    hd: row.int('hd'),
    gl: row.text('gl'),
    gaiaSourceId: row.sourceId('gaia_source_id'),
    reason: row.oneOf('reason', PARKED_REASONS),
  }),
  encode: (e: ParkedLedgerEntry) => ({
    tyc: nullableCell(e.tyc),
    hip: nullableCell(e.hip),
    hd: nullableCell(e.hd),
    gl: nullableCell(e.gl),
    gaia_source_id: nullableCell(e.gaiaSourceId),
    reason: e.reason,
  }),
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

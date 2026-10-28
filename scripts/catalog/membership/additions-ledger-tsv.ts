// Codec for data/membership/additions-ledger.tsv. See README.md#the-additions.

import { defineArtifact } from '../../util/tsv/artifact-pure';

export const ADDITIONS_LEDGER_FILE = 'data/membership/additions-ledger.tsv';

export const LEDGER_COLUMNS = ['tyc', 'hip', 'hd', 'gl', 'gaia_source_id', 'reason'] as const;
export type AdditionLedgerRow = Record<(typeof LEDGER_COLUMNS)[number], string>;

export const ADDITIONS_LEDGER = defineArtifact({
  file: ADDITIONS_LEDGER_FILE,
  columns: LEDGER_COLUMNS,
  hint: 'Re-run `pnpm run build:membership`.',
  order: 'by-line',
  decode: (row): AdditionLedgerRow => ({
    tyc: row.raw('tyc'), hip: row.raw('hip'), hd: row.raw('hd'), gl: row.raw('gl'),
    gaia_source_id: row.raw('gaia_source_id'), reason: row.raw('reason'),
  }),
  encode: (r) => r,
});

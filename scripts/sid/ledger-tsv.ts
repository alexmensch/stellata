// See README.md (ledger-tsv.ts) and /docs/sid.md#43-ledger--datasidledgertsv.

import { defineArtifact } from '../util/tsv/artifact-pure';
import { decodeLedgerRow, encodeLedgerRow, LEDGER_COLUMNS, type LedgerRow } from './ledger-pure';
import { registryFile, type RegistryFile } from './sid-pure';

export const LEDGER = defineArtifact({
  file: 'data/sid/ledger.tsv',
  columns: LEDGER_COLUMNS,
  hint: 'It grows only through `pnpm run sid:allocate`.',
  order: 'as-given',
  decode: decodeLedgerRow,
  encode: encodeLedgerRow,
});

export function ledgerFile(text: string): RegistryFile<LedgerRow> {
  return registryFile(LEDGER.table, LEDGER.decode, text);
}

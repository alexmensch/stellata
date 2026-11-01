// See README.md (ledger-tsv.ts) and /docs/sid.md#43-ledger--datasidledgertsv.

import { defineArtifact } from '../util/tsv/artifact-pure';
import { decodeLedgerRow, encodeLedgerRow, LEDGER_COLUMNS, type LedgerRow } from './ledger-pure';
import { registryPaths } from './registry-outputs';
import { REGISTRY_PARTITIONS, registryHint } from './registry-partitions-pure';
import { registryFile, type RegistryFile } from './sid-pure';

function ledgerArtifact(partition: string) {
  return defineArtifact({
    file: registryPaths(partition).ledger,
    columns: LEDGER_COLUMNS,
    hint: registryHint(partition),
    order: 'as-given',
    decode: decodeLedgerRow,
    encode: encodeLedgerRow,
  });
}

export const LEDGERS: Readonly<Record<string, ReturnType<typeof ledgerArtifact>>> = Object.fromEntries(
  REGISTRY_PARTITIONS.map((p) => [p, ledgerArtifact(p)]),
);

export function ledgerFile(partition: string, text: string): RegistryFile<LedgerRow> {
  const { table, decode } = LEDGERS[partition];
  return registryFile(table, decode, text);
}

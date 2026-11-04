// See README.md (ledger-tsv.ts) and /docs/sid.md#43-ledger--datasidledgertsv.

import { defineArtifact } from '../util/tsv/artifact-pure';
import { decodeLedgerRow, encodeLedgerRow, LEDGER_COLUMNS, type LedgerRow } from './ledger-pure';
import { REGISTRY_PARTITIONS, registryHint, type RegistryPartition } from './registry-partitions-pure';
import { registryFile, type RegistryFile } from './sid-pure';
import { registryPaths } from '../../src/catalog-format/pipeline-outputs/data-files';

function ledgerArtifact(partition: RegistryPartition) {
  return defineArtifact({
    file: registryPaths(partition).ledger,
    columns: LEDGER_COLUMNS,
    hint: registryHint(partition),
    order: 'as-given',
    decode: decodeLedgerRow,
    encode: encodeLedgerRow,
  });
}

export const LEDGERS = Object.fromEntries(
  REGISTRY_PARTITIONS.map((p) => [p, ledgerArtifact(p)]),
) as Readonly<Record<RegistryPartition, ReturnType<typeof ledgerArtifact>>>;

export function ledgerFile(partition: RegistryPartition, text: string): RegistryFile<LedgerRow> {
  const { table, decode } = LEDGERS[partition];
  return registryFile(table, decode, text);
}

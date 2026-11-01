// See README.md (events-tsv.ts) and /docs/sid.md#43-ledger--datasidledgertsv.

import { defineArtifact } from '../util/tsv/artifact-pure';
import { decodeEventRow, encodeEventRow, EVENT_COLUMNS, type EventRow } from './events-pure';
import { registryPaths } from './registry-outputs';
import { REGISTRY_PARTITIONS, registryHint } from './registry-partitions-pure';
import { registryFile, type RegistryFile } from './sid-pure';

function eventsArtifact(partition: string) {
  return defineArtifact({
    file: registryPaths(partition).events,
    columns: EVENT_COLUMNS,
    hint: registryHint(partition),
    order: 'as-given',
    decode: decodeEventRow,
    encode: encodeEventRow,
  });
}

export const EVENTS: Readonly<Record<string, ReturnType<typeof eventsArtifact>>> = Object.fromEntries(
  REGISTRY_PARTITIONS.map((p) => [p, eventsArtifact(p)]),
);

export function eventsFile(partition: string, text: string): RegistryFile<EventRow> {
  const { table, decode } = EVENTS[partition];
  return registryFile(table, decode, text);
}

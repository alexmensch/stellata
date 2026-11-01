// See README.md (events-tsv.ts) and /docs/sid.md#43-ledger--datasidledgertsv.

import { defineArtifact } from '../util/tsv/artifact-pure';
import { decodeEventRow, encodeEventRow, EVENT_COLUMNS, type EventRow } from './events-pure';
import { registryFile, type RegistryFile } from './sid-pure';

export const EVENTS = defineArtifact({
  file: 'data/sid/events.tsv',
  columns: EVENT_COLUMNS,
  hint: 'It grows only through SID allocation in `pnpm run build:catalog`.',
  order: 'as-given',
  decode: decodeEventRow,
  encode: encodeEventRow,
});

export function eventsFile(text: string): RegistryFile<EventRow> {
  return registryFile(EVENTS.table, EVENTS.decode, text);
}

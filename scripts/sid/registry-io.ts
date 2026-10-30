// The committed SID registry, read and structurally validated for a read-only consumer.

import { readArtifact } from '../util/sources/source';
import { LEDGER } from './ledger-tsv';
import { validateEvents, type EventRow } from './events-pure';
import { EVENTS } from './events-tsv';
import { REASON_CODES } from '../catalog/lineage/reason-codes-tsv';
import { validateLedger, type LedgerRow, type SameasEdge } from './sid-pure';
import { loadStoredEdges } from './stored-edges';

export interface Registry {
  ledger: LedgerRow[];
  events: EventRow[];
  storedEdges: SameasEdge[];
}

export function loadRegistry(): Registry {
  const ledger = readArtifact(LEDGER);
  const events = readArtifact(EVENTS);
  const codes = new Set(readArtifact(REASON_CODES).map((e) => e.code));
  const errors = [
    ...validateLedger(ledger),
    ...validateEvents(events, ledger.length, (code) => codes.has(code)),
  ];
  if (errors.length > 0) {
    throw new Error(`SID registry is structurally invalid:\n  ${errors.join('\n  ')}`);
  }
  return { ledger, events, storedEdges: loadStoredEdges() };
}

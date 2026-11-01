// The committed SID registry: read and structurally validated, and its files rewritten with an allocation's appends.

import { packageVersion } from '../util/git-provenance';
import { artifactText, readArtifact } from '../util/sources/source';
import { LEDGER, ledgerFile } from './ledger-tsv';
import { validateEvents, type EventRow } from './events-pure';
import { EVENTS, eventsFile } from './events-tsv';
import { REASON_CODES } from '../catalog/lineage/reason-codes-tsv';
import type { REGISTRY_FILES } from './registry-outputs';
import { computeLedgerHead, validateLedger, type LedgerRow, type SameasEdge } from './sid-pure';
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

/** The date and build version this run's mints and events carry. */
export function allocationRun(): { date: string; version: string } {
  return { date: new Date().toISOString().slice(0, 10), version: packageVersion() };
}

/** The ledger and events with the allocation's rows appended, never a committed line rewritten, and the head recomputed over both. */
export function registryTexts(
  minted: readonly LedgerRow[], events: readonly EventRow[],
): Record<keyof typeof REGISTRY_FILES, string> {
  const sidLedger = artifactText(LEDGER) + minted.map((r) => `${LEDGER.encodeLine(r)}\n`).join('');
  const sidEvents = artifactText(EVENTS) + events.map((e) => `${EVENTS.encodeLine(e)}\n`).join('');
  const head = computeLedgerHead(ledgerFile(sidLedger), eventsFile(sidEvents));
  return { sidLedger, sidEvents, sidHead: `${JSON.stringify(head, null, 2)}\n` };
}

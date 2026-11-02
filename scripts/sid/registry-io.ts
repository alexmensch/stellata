// The committed SID registry: every partition read and structurally validated, and one partition's files rewritten with an allocation's appends.

import { packageVersion } from '../util/git-provenance';
import { artifactText, readArtifact } from '../util/sources/source';
import { LEDGERS } from './ledger-tsv';
import type { EventRow } from './events-pure';
import { EVENTS } from './events-tsv';
import { REASON_CODES } from '../catalog/lineage/reason-codes-tsv';
import { REGISTRY_PARTITIONS, registryKeys, type RegistryKey, type RegistryPartition } from './registry-partitions-pure';
import { unionLedger, validateRegistry } from './registry-pure';
import { computeLedgerHead, type LedgerRow, type SameasEdge } from './sid-pure';
import { loadStoredEdges } from './stored-edges';

export interface Registry {
  /** Every partition's rows, by sid: the sequence each allocation mints past. */
  ledger: LedgerRow[];
  /** Every partition's events. */
  events: EventRow[];
  storedEdges: SameasEdge[];
}

export function loadRegistry(): Registry {
  const parts = REGISTRY_PARTITIONS.map((partition) => ({
    partition,
    ledger: readArtifact(LEDGERS[partition]),
    events: readArtifact(EVENTS[partition]),
  }));
  const codes = new Set(readArtifact(REASON_CODES).map((e) => e.code));
  const errors = validateRegistry(parts, (code) => codes.has(code));
  if (errors.length > 0) {
    throw new Error(`SID registry is structurally invalid:\n  ${errors.join('\n  ')}`);
  }
  return {
    ledger: unionLedger(parts),
    events: parts.flatMap((p) => p.events),
    storedEdges: loadStoredEdges(),
  };
}

/** The date and build version this run's mints and events carry. */
export function allocationRun(): { date: string; version: string } {
  return { date: new Date().toISOString().slice(0, 10), version: packageVersion() };
}

/** One partition's ledger and events with the allocation's rows appended, never a committed line rewritten, and its head recomputed over both. */
export function registryTexts<P extends RegistryPartition>(
  partition: P, minted: readonly LedgerRow[], events: readonly EventRow[],
): Record<RegistryKey<P>, string> {
  const ledgerArtifact = LEDGERS[partition];
  const eventsArtifact = EVENTS[partition];
  const ledger = artifactText(ledgerArtifact) + minted.map((r) => `${ledgerArtifact.encodeLine(r)}\n`).join('');
  const eventsText = artifactText(eventsArtifact) + events.map((e) => `${eventsArtifact.encodeLine(e)}\n`).join('');
  const keys = registryKeys(partition);
  return {
    [keys.ledger]: ledger,
    [keys.events]: eventsText,
    [keys.head]: `${JSON.stringify(computeLedgerHead(ledger, eventsText), null, 2)}\n`,
  } as Record<RegistryKey<P>, string>;
}

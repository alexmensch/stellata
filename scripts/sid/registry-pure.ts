// The registry across its partitions: their ledgers as one SID sequence, and structural validation of the whole. See README.md#registry-partitions.

import { validateEvents, type EventRow } from './events-pure';
import { inPartition, type RegistryPartition } from './registry-partitions-pure';
import { isValidDesignation, parseDesignation, validateLedger, type LedgerRow } from './sid-pure';

export interface PartitionRows {
  partition: RegistryPartition;
  ledger: readonly LedgerRow[];
  events: readonly EventRow[];
}

const leadingSid = (line: string): number => Number(line.slice(0, line.indexOf('\t')));

/** Every partition's rows as the one sequence SIDs are allocated from, by sid. */
export function unionLedger(parts: readonly PartitionRows[]): LedgerRow[] {
  return parts.flatMap((p) => p.ledger).sort((a, b) => a.sid - b.sid);
}

/** The same union over ledger data lines, never decoded. */
export function unionLedgerLines(parts: readonly (readonly string[])[]): string[] {
  return parts.flat().sort((a, b) => leadingSid(a) - leadingSid(b));
}

export function validateRegistry(parts: readonly PartitionRows[], isCode: (code: string) => boolean): string[] {
  const errors = validateLedger(unionLedger(parts));
  for (const { partition, ledger, events } of parts) {
    const owns = inPartition(partition);
    ledger.forEach((row, i) => {
      if (i > 0 && row.sid <= ledger[i - 1].sid) errors.push(`${partition} ledger: sid ${row.sid} follows ${ledger[i - 1].sid}`);
      if (isValidDesignation(row.canonicalKey) && !owns(parseDesignation(row.canonicalKey).ns)) {
        errors.push(`${partition} ledger: sid ${row.sid} keys "${row.canonicalKey}", another partition's namespace`);
      }
    });
    const sids = new Set(ledger.map((r) => r.sid));
    errors.push(...validateEvents(events, (sid) => sids.has(sid), isCode).map((e) => `${partition} events: ${e}`));
  }
  return errors;
}

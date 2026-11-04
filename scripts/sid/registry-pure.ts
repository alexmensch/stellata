// The registry across its partitions: their ledgers as one SID sequence, structural validation of the whole, and its append-only check. See README.md#registry-partitions.

import { validateEvents, type EventRow } from './events-pure';
import { inPartition } from './registry-partitions-pure';
import {
  checkAppendOnly, EMPTY_HEAD_TRIPLE, isValidDesignation, parseDesignation, validateLedger, type LedgerHead, type LedgerRow,
} from './sid-pure';
import { CATALOG_PARTITION, type RegistryPartition } from '../../src/catalog-format/pipeline-outputs/data-files';

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

export interface PartitionLines {
  partition: RegistryPartition;
  ledger: readonly string[];
  events: readonly string[];
}

export type AppendOnlyVerdict =
  | { kind: 'unchecked' }
  | { kind: 'checked'; errors: string[] };

/** Each partition's data lines against its merge-base head (null where the base has none). */
export function registryAppendOnly(
  bases: ReadonlyMap<RegistryPartition, LedgerHead | null>, current: readonly PartitionLines[],
): AppendOnlyVerdict {
  const base = (p: RegistryPartition): LedgerHead | null => bases.get(p) ?? null;
  const catalogBase = base(CATALOG_PARTITION);
  if (catalogBase === null) return { kind: 'unchecked' };
  // A base with no sibling head predates the partitions: its one ledger
  // held every namespace, so the sid-ordered union is what it froze.
  const unsplit = current.every((f) => f.partition === CATALOG_PARTITION || base(f.partition) === null);
  const ledgerErrors = unsplit
    ? checkAppendOnly(catalogBase.ledger, unionLedgerLines(current.map((f) => f.ledger)), 'ledger union', { newSidsPastBaseMax: true })
    : current.flatMap((f) => checkAppendOnly(
      base(f.partition)?.ledger ?? EMPTY_HEAD_TRIPLE, [...f.ledger], `${f.partition} ledger`, { newSidsPastBaseMax: true },
    ));
  // A head written before events.tsv existed freezes zero rows.
  const eventErrors = current.flatMap((f) => checkAppendOnly(
    base(f.partition)?.events ?? EMPTY_HEAD_TRIPLE, [...f.events], `${f.partition} events`, { newSidsPastBaseMax: false },
  ));
  return { kind: 'checked', errors: [...ledgerErrors, ...eventErrors] };
}

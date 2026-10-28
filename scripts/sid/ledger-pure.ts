// ledger.tsv's row shape and cell encoding, apart from its declaration. See README.md (ledger-tsv.ts).

import type { TableRow } from '../util/tsv/table-pure';

export const SID_KINDS = ['star', 'cloud', 'galaxy', 'planet', 'shell', 'probe'] as const;
export type SidKind = (typeof SID_KINDS)[number];

export interface LedgerRow {
  sid: number;
  canonicalKey: string;
  kind: SidKind;
  firstSeen: string;
}

export const LEDGER_COLUMNS = ['sid', 'canonical_key', 'kind', 'first_seen'] as const;
type LedgerColumn = (typeof LEDGER_COLUMNS)[number];

export function decodeLedgerRow(row: TableRow<LedgerColumn>): LedgerRow {
  return {
    sid: row.requiredId('sid'),
    canonicalKey: row.raw('canonical_key'),
    kind: row.oneOf('kind', SID_KINDS),
    firstSeen: row.raw('first_seen'),
  };
}

export function encodeLedgerRow(r: LedgerRow): Record<LedgerColumn, string> {
  return {
    sid: String(r.sid),
    canonical_key: r.canonicalKey,
    kind: r.kind,
    first_seen: r.firstSeen,
  };
}

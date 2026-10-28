// See README.md (ledger-tsv.ts) and /docs/sid.md#43-ledger--datasidledgertsv.

import { defineArtifact } from '../util/tsv/artifact-pure';
import type { TableRow } from '../util/tsv/table-pure';

export const SID_KINDS = ['star', 'cloud', 'galaxy', 'planet', 'shell', 'probe'] as const;
export type SidKind = (typeof SID_KINDS)[number];

export interface LedgerRow {
  sid: number;
  canonicalKey: string;
  kind: SidKind;
  firstSeen: string;
}

const DIGITS_RE = /^\d+$/;

/** Bare digits only: the append-only guard hashes raw lines, so a signed or
 *  padded sid must be refused rather than read as the number it spells. */
export function sidCell<C extends string>(row: TableRow<C>, c: C): number | null {
  const v = row.raw(c);
  if (v === '') return null;
  return DIGITS_RE.test(v) ? Number(v) : row.fail(`${c} "${v}" is not a sid`);
}

export function requireSid<C extends string>(row: TableRow<C>, c: C): number {
  return sidCell(row, c) ?? row.fail(`${c} is empty`);
}

export const LEDGER = defineArtifact({
  file: 'data/sid/ledger.tsv',
  columns: ['sid', 'canonical_key', 'kind', 'first_seen'] as const,
  hint: 'It grows only through `pnpm run sid:allocate`.',
  order: 'as-given',
  decode: (row): LedgerRow => ({
    sid: requireSid(row, 'sid'),
    canonicalKey: row.raw('canonical_key'),
    kind: row.oneOf('kind', SID_KINDS),
    firstSeen: row.raw('first_seen'),
  }),
  encode: (r) => ({
    sid: String(r.sid),
    canonical_key: r.canonicalKey,
    kind: r.kind,
    first_seen: r.firstSeen,
  }),
});

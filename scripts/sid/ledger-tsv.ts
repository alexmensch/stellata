// See README.md (ledger-tsv.ts) and /docs/sid.md#43-ledger--datasidledgertsv.

import { defineArtifact } from '../util/tsv/artifact-pure';

export const SID_KINDS = ['star', 'cloud', 'galaxy', 'planet', 'shell', 'probe'] as const;
export type SidKind = (typeof SID_KINDS)[number];

export interface LedgerRow {
  sid: number;
  canonicalKey: string;
  kind: SidKind;
  firstSeen: string;
}

export const LEDGER = defineArtifact({
  file: 'data/sid/ledger.tsv',
  columns: ['sid', 'canonical_key', 'kind', 'first_seen'] as const,
  hint: 'It grows only through `pnpm run sid:allocate`.',
  order: 'as-given',
  decode: (row): LedgerRow => ({
    sid: row.requiredId('sid'),
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

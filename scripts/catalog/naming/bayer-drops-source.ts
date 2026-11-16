// The Bayer designations AT-HYG printed that the naming authority does not reach, with why, declared.

import { defineSource, type Declared } from '../../util/sources/source';
import { readTable } from '../../util/tsv/table-pure';

export const BAYER_DROP_REASONS = ['authority_omits', 'sibling_holds'] as const;
export type BayerDropReason = (typeof BAYER_DROP_REASONS)[number];

export interface BayerDropRow {
  hd: number;
  bayer: string;
  reason: BayerDropReason;
}

export function parseBayerDrops(text: string, from: Declared): BayerDropRow[] {
  const columns = ['hd', 'bayer', 'reason', 'evidence'] as const;
  return [...readTable({ ...from, columns }, text)].map((row) => {
    row.requiredText('evidence');
    const hd = row.int('hd');
    if (hd === null) return row.fail('needs an hd');
    return { hd, bayer: row.requiredText('bayer'), reason: row.oneOf('reason', BAYER_DROP_REASONS) };
  });
}

export const BAYER_DROPS = defineSource({
  file: 'data/naming/bayer_drops.tsv',
  hint: 'It is hand-curated: restore the hd, bayer, reason and evidence columns.',
  parse: (input) => parseBayerDrops(input.text(), input),
});

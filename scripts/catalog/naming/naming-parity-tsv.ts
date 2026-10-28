// Codec for naming-parity.tsv. See README.md#the-parity-ledger.

import { defineArtifact } from '../../util/tsv/artifact-pure';
import { RESOLVES, byText, type ParityRow } from './naming-parity-pure';

export const NAMING_PARITY = defineArtifact({
  file: 'scripts/catalog/naming/naming-parity.tsv',
  columns: ['key', 'old', 'new', 'resolves'] as const,
  hint: 'Re-run `pnpm run build:naming-parity`.',
  order: byText((r: ParityRow) => r.key),
  decode: (row): ParityRow => {
    const key = row.raw('key');
    const old = row.raw('old');
    const resolves = row.oneOf('resolves', RESOLVES);
    if (resolves === 'absent') {
      if (row.raw('new') !== '') row.fail('an absent record composes no label');
      return { key, old, record: { present: false } };
    }
    return { key, old, record: { present: true, new: row.raw('new'), resolves: resolves === 'yes' } };
  },
  encode: (r) => ({
    key: r.key,
    old: r.old,
    new: r.record.present ? r.record.new : '',
    resolves: !r.record.present ? 'absent' : r.record.resolves ? 'yes' : 'no',
  }),
});

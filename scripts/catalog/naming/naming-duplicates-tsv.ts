// Codec for naming-duplicates.tsv. See README.md#the-parity-ledger.

import { byText, defineArtifact } from '../../util/tsv/artifact-pure';
import type { DuplicateRow } from './naming-parity-pure';

const KEY_SEPARATOR = '|';

export const NAMING_DUPLICATES = defineArtifact({
  file: 'scripts/catalog/naming/naming-duplicates.tsv',
  columns: ['label', 'keys'] as const,
  hint: 'Re-run `pnpm run build:naming-parity`.',
  order: byText((r: DuplicateRow) => r.label),
  decode: (row): DuplicateRow => ({
    label: row.raw('label'),
    keys: row.raw('keys').split(KEY_SEPARATOR),
  }),
  encode: (r) => ({ label: r.label, keys: r.keys.join(KEY_SEPARATOR) }),
});

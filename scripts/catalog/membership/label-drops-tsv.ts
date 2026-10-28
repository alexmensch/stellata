// Codec for data/membership/label-drops.tsv. See README.md#the-unattested-labels-leave-the-row.

import { defineArtifact } from '../../util/tsv/artifact-pure';
import {
  LABEL_DROP_COLUMNS,
  LABEL_DROP_REASONS,
  type LabelDropRow,
} from './ledger-rows-pure';

export const LABEL_DROPS_FILE = 'data/membership/label-drops.tsv';

export const LABEL_DROPS = defineArtifact({
  file: LABEL_DROPS_FILE,
  columns: LABEL_DROP_COLUMNS,
  hint: 'Re-run `pnpm run build:membership`.',
  order: 'by-line',
  decode: (row): LabelDropRow => {
    row.oneOf('reason', LABEL_DROP_REASONS);
    row.sourceId('gaia_source_id');
    return row.cells();
  },
  encode: (r) => r,
});

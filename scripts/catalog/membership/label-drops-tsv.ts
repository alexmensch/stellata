// Codec for data/membership/label-drops.tsv. See README.md#the-unattested-labels-leave-the-row.

import { defineArtifact } from '../../util/tsv/artifact-pure';
import { recordKeyCells, rowRecordIdentifiers } from '../lineage/identity-pure';
import {
  LABEL_DROP_CELLS,
  LABEL_DROP_COLUMNS,
  LABEL_DROP_REASONS,
  type LabelDropRow,
} from './ledger-rows-pure';
import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';

export const LABEL_DROPS = defineArtifact({
  file: DATA_FILES.labelDrops,
  columns: LABEL_DROP_COLUMNS,
  hint: 'Re-run `pnpm run build:membership`.',
  order: 'by-line',
  decode: (row): LabelDropRow => ({
    ...rowRecordIdentifiers(row),
    cell: row.oneOf('cell', LABEL_DROP_CELLS),
    value: row.requiredId('value'),
    reason: row.oneOf('reason', LABEL_DROP_REASONS),
  }),
  encode: (r) => ({ ...recordKeyCells(r), cell: r.cell, value: String(r.value), reason: r.reason }),
});

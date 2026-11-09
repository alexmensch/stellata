// The Stage 2 spot-check's hand-curated ground truth, declared.

import { defineSource } from '../../util/sources/source';
import { readTable } from '../../util/tsv/table-pure';
import { SPOT_CHECK_COLUMNS, truthRow } from './spot-check-pure';

export const SPOT_CHECK_GROUND_TRUTH = defineSource({
  file: 'data/binaries/spot_check_ground_truth.tsv',
  hint: 'Hand-curated: edit the file.',
  parse: (input) => [...readTable({ ...input, columns: SPOT_CHECK_COLUMNS }, input.text())].map(truthRow),
});

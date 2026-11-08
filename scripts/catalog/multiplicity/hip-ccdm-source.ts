// The Hipparcos HIP↔CCDM cross-reference (an I/239 slice), declared.

import { defineSource } from '../../util/sources/source';
import { columnTable } from '../../util/tsv/table-pure';
import { skipVizierRule } from './vizier-rule-pure';

export const HIP_CCDM = defineSource({
  file: 'data/hipparcos/hip_ccdm.tsv',
  hint: 'Re-fetch from VizieR with -out=HIP,CCDM,MultFlag.',
  parse: (input) => skipVizierRule(columnTable({ file: input.file, hint: input.hint, comments: true }, input.text())),
});

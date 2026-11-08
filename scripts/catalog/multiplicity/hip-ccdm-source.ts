// The Hipparcos HIP↔CCDM cross-reference (an I/239 slice), declared.

import { defineSource } from '../../util/sources/source';
import { columnTable, type ColumnTable } from '../../util/tsv/table-pure';

/** VizieR rules a dash line under its header, after a units line the reader
 *  already skips as blank. */
const VIZIER_RULE = /^[-\t]+$/;

export const HIP_CCDM = defineSource({
  file: 'data/hipparcos/hip_ccdm.tsv',
  hint: 'Re-fetch from VizieR with -out=HIP,CCDM,MultFlag.',
  parse: (input): ColumnTable => {
    const table = columnTable({ file: input.file, hint: input.hint, comments: true }, input.text());
    return function* dataRows<C extends string>(columns: readonly C[]) {
      for (const row of table(columns)) if (!VIZIER_RULE.test(row.rawLine)) yield row;
    };
  },
});

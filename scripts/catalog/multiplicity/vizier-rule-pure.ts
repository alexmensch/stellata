// A VizieR TSV's table past the dash line VizieR rules under its header.

import type { ColumnTable } from '../../util/tsv/table-pure';

const VIZIER_RULE = /^[-\t]+$/;

/** The units line above the rule is blank, which the reader already skips. */
export function skipVizierRule(table: ColumnTable): ColumnTable {
  return function* dataRows<C extends string>(columns: readonly C[]) {
    for (const row of table(columns)) if (!VIZIER_RULE.test(row.rawLine)) yield row;
  };
}

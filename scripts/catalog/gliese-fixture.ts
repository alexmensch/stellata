// Test-only V/70A table text. See README.md.

/** Rows are tab-joined cells in this header's order; a row may stop short. */
export const GLIESE_FIXTURE_HEADER = ['name', 'comp', 'vmag', 'bv', 'sp', 'plx_mas', 'e_plx_mas', 'n_plx', 'hd'];

export function glieseTsv(...rows: readonly string[]): string {
  return [GLIESE_FIXTURE_HEADER.join('\t'), ...rows].join('\n') + '\n';
}

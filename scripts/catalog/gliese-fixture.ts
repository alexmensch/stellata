// Test-only V/70A table text and GlieseRow builder. See README.md.

import { sourceRowRef } from '../util/sources/row-ref-pure';
import { GLIESE_COLUMNS, type GlieseRow } from './gliese-parse-pure';
import { GLIESE } from './gliese-source';

/** A row keyed `key` with every nullable column absent, so a suite states
 *  only the columns its assertion turns on. */
export function glieseRow(key: string, overrides: Partial<GlieseRow> = {}): GlieseRow {
  return {
    name: `Gl ${key}`, comp: '', vMag: null, bMinusV: null, spectral: null,
    parallax: null, hd: null, astrometryB1950: null,
    ref: sourceRowRef(GLIESE, key),
    ...overrides,
  };
}

/** Rows are tab-joined cells in `GLIESE_COLUMNS` order; a row may stop short. */
export function glieseTsv(...rows: readonly string[]): string {
  return [GLIESE_COLUMNS.join('\t'), ...rows].join('\n') + '\n';
}

// Test-only V/70A table text and GlieseRow builder. See README.md.

import { sourceRowRef } from '../util/sources/row-ref-pure';
import type { GlieseRow } from './gliese-parse-pure';
import { GLIESE } from './gliese-source';

/** Rows are tab-joined cells in this header's order; a row may stop short. */
export const GLIESE_FIXTURE_HEADER = ['name', 'comp', 'vmag', 'bv', 'sp', 'plx_mas', 'e_plx_mas', 'n_plx', 'hd',
  'ra_b1950_deg', 'de_b1950_deg', 'pm_arcsec_yr', 'pm_pa_deg'];

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

export function glieseTsv(...rows: readonly string[]): string {
  return [GLIESE_FIXTURE_HEADER.join('\t'), ...rows].join('\n') + '\n';
}

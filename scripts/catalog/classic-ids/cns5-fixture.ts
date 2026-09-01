// Test-only Cns5Row builder. A module rather than an export from one test
// file: two suites here build these rows, so a column added to the interface
// lands in one place instead of breaking every literal.

import type { Cns5Row } from './classic-ids-parse';

export function cns5Row(overrides: Partial<Cns5Row> = {}): Cns5Row {
  return {
    cns5: 1,
    gj: '1',
    gjComp: null,
    hip: null,
    gaiaSourceId: null,
    astrometry: null,
    ...overrides,
  };
}

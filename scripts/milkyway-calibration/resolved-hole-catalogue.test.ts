import { describe, expect, it } from 'vitest';

import { RESOLVED_HOLE_CATALOGUE_RECORDS } from '../../src/astro-core/milkyway/calibration/resolved-hole-table';
import { committedBuildCounts } from '../catalog/build-counts';

describe('resolved-hole table provenance', () => {
  it('was measured on the catalogue the build pins', () => {
    expect(
      RESOLVED_HOLE_CATALOGUE_RECORDS,
      'resolved-hole-table.ts is stale against build-catalog-expected.json — re-run: pnpm run measure:band-resolved',
    ).toBe(committedBuildCounts().recordCount);
  });
});

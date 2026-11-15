import { describe, expect, it } from 'vitest';

import { SEEDED_BRANCH, seededCodeCheck } from '../lineage/count-block-fixture';
import { invariantViolations } from '../lineage/lineage-invariant-pure';
import { decodeLineageLine, paramsText } from '../lineage/lineage-row-pure';
import { OVERLAP_CODES, OVERLAP_INVARIANTS, overlapLineageLines } from './overlap-lineage-pure';

const records = [{ originKey: 'multiples:00000+0000-AB/B' }, { originKey: 'gaia-dr3:7' }, { originKey: 'hip:9' }];

describe('overlapLineageLines', () => {
  it('writes one row per pair, keyed on the origin key first in byte order, whichever record sorts first', () => {
    const rows = overlapLineageLines([[0, 1], [2, 1]], records).map(decodeLineageLine);
    expect(rows.map((r) => [r.key, r.code, r.params])).toEqual([
      ['gaia-dr3:7', 'overlap.inside', paramsText({ other: 'multiples:00000+0000-AB/B' })],
      ['gaia-dr3:7', 'overlap.inside', paramsText({ other: 'hip:9' })],
    ]);
  });

  it('folds into a count block a new code reaches', () => {
    const { drift, refreshed } = seededCodeCheck(OVERLAP_CODES, overlapLineageLines([[0, 1]], records));
    expect(drift.report).toContain(`overlap.${SEEDED_BRANCH}`);
    expect(refreshed.drifted).toBe(false);
  });

  it('a listed pair passes; a new pair fails by name though its key is a listed row\'s', () => {
    const listed = [{ originKey: 'multiples:00315-6257-FH/H' }, { originKey: 'multiples:00315-6257-FI/I' }];
    const unlisted = [listed[0], { originKey: 'multiples:99999+9999-AB/B' }];
    const lines = [...overlapLineageLines([[0, 1]], listed), ...overlapLineageLines([[0, 1]], unlisted)];
    const [v] = invariantViolations(OVERLAP_INVARIANTS, lines);
    expect(v.rows.map((r) => [r.key, r.params])).toEqual([
      ['multiples:00315-6257-FH/H', paramsText({ other: 'multiples:99999+9999-AB/B' })],
    ]);
  });
});

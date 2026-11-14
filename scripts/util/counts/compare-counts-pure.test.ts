import { describe, it, expect } from 'vitest';
import { compareBuildCounts, compareCountSnapshot, driftedRows, formatCountDiff } from './compare-counts-pure';

function baseCounts() {
  return {
    recordCount: 313242,
    gcvsMatched: 3677,
    searchEntries: 290000,
    figureCount: 500,
    tierPartition: { bailer_jones: 58, gaia_dr3_inversion: 2, hip2_parallax: 0, cns5_plx: 0 },
  };
}

type FixtureCounts = ReturnType<typeof baseCounts>;

// Scalar keys contribute one diff row; a partition key contributes one per
// bucket.
function expectedDiffRows(counts: FixtureCounts): number {
  return Object.values(counts).reduce<number>(
    (n, v) => n + (typeof v === 'number' ? 1 : Object.keys(v).length),
    0,
  );
}

function drifted(expected: FixtureCounts, actual: FixtureCounts) {
  return driftedRows(compareBuildCounts(expected, actual));
}

describe('compareBuildCounts', () => {
  it('reports every key as match when expected === actual', () => {
    const counts = baseCounts();
    const diff = compareBuildCounts(counts, counts);
    expect(diff).toHaveLength(expectedDiffRows(counts));
    expect(diff.every((d) => d.status === 'match')).toBe(true);
  });

  it('flags only the keys that differ', () => {
    const expected = baseCounts();
    const actual = baseCounts();
    actual.recordCount = 313243;
    actual.gcvsMatched = 3678;
    const diff = compareBuildCounts(expected, actual);
    const mismatches = diff.filter((d) => d.status === 'mismatch');
    expect(mismatches).toEqual([
      { key: 'recordCount', status: 'mismatch', expected: 313242, actual: 313243 },
      { key: 'gcvsMatched', status: 'mismatch', expected: 3677, actual: 3678 },
    ]);
  });

  it('names the drifting bucket of a partition, not the whole partition', () => {
    const expected = baseCounts();
    const actual = baseCounts();
    actual.tierPartition.hip2_parallax = 11;
    const mismatches = compareBuildCounts(expected, actual)
      .filter((d) => d.status === 'mismatch');
    expect(mismatches).toEqual([{
      key: 'tierPartition.hip2_parallax',
      status: 'mismatch',
      expected: 0,
      actual: 11,
    }]);
  });

  it('flags a partition bucket the snapshot has no entry for', () => {
    const expected = baseCounts();
    const actual = baseCounts();
    delete (expected.tierPartition as Partial<Record<string, number>>).gaia_dr3_inversion;
    expect(drifted(expected, actual)).toEqual([{
      key: 'tierPartition.gaia_dr3_inversion',
      status: 'absent-from-snapshot',
      actual: actual.tierPartition.gaia_dr3_inversion,
    }]);
  });

  it('flags a new count the snapshot has no entry for', () => {
    const expected = baseCounts();
    const actual = baseCounts();
    delete (expected as Partial<FixtureCounts>).gcvsMatched;
    expect(drifted(expected, actual)).toEqual([
      { key: 'gcvsMatched', status: 'absent-from-snapshot', actual: actual.gcvsMatched },
    ]);
  });

  it('flags a count present in the snapshot but absent from the build', () => {
    const expected = baseCounts();
    const actual = baseCounts();
    delete (actual as Partial<FixtureCounts>).gcvsMatched;
    expect(drifted(expected, actual)).toEqual([
      { key: 'gcvsMatched', status: 'absent-from-build', expected: expected.gcvsMatched },
    ]);
  });

  it('flags a partition bucket the build no longer produces', () => {
    const expected = baseCounts();
    const actual = baseCounts();
    delete (actual.tierPartition as Partial<Record<string, number>>).bailer_jones;
    expect(drifted(expected, actual)).toEqual([{
      key: 'tierPartition.bailer_jones',
      status: 'absent-from-build',
      expected: expected.tierPartition.bailer_jones,
    }]);
  });

  it('names a snapshot count that is null rather than a number', () => {
    const expected = { ...baseCounts(), gcvsMatched: null } as unknown as FixtureCounts;
    expect(() => compareBuildCounts(expected, baseCounts()))
      .toThrow('count gcvsMatched is null, not a number or a partition');
  });

  it('lists snapshot-only rows after the actual rows', () => {
    const expected = baseCounts();
    const actual = baseCounts();
    delete (actual as Partial<FixtureCounts>).recordCount;
    const keys = compareBuildCounts(expected, actual).map((d) => d.key);
    expect(keys.at(-1)).toBe('recordCount');
  });

  it('preserves the key order of the actual object, partitions expanded', () => {
    const actual = baseCounts();
    const diff = compareBuildCounts(baseCounts(), actual);
    const flatKeys = Object.entries(actual).flatMap(([k, v]) => (
      typeof v === 'number' ? [k] : Object.keys(v).map((b) => `${k}.${b}`)
    ));
    expect(diff.map((d) => d.key)).toEqual(flatKeys);
  });
});

describe('formatCountDiff', () => {
  it('produces a single match line when nothing differs', () => {
    const counts = baseCounts();
    const out = formatCountDiff(compareBuildCounts(counts, counts));
    expect(out).toMatch(/all \d+ counts match/);
    expect(out.split('\n')).toHaveLength(1);
  });

  it('lists each mismatch with signed delta', () => {
    const expected = baseCounts();
    const actual = baseCounts();
    actual.recordCount = 313_240; // -2
    actual.gcvsMatched = 3_680;   // +3
    const out = formatCountDiff(compareBuildCounts(expected, actual));
    expect(out).toMatch(/2 of \d+ counts differ/);
    expect(out).toMatch(/recordCount\s+expected 313242, got 313240 \(-2\)/);
    expect(out).toMatch(/gcvsMatched\s+expected 3677, got 3680 \(\+3\)/);
  });

  it('header reports the mismatched count, not the matched count', () => {
    const expected = baseCounts();
    const actual = baseCounts();
    actual.searchEntries = 99999;
    const out = formatCountDiff(compareBuildCounts(expected, actual));
    expect(out).toMatch(/1 of \d+ counts differ/);
  });

  it('labels a partition mismatch with its dotted bucket key', () => {
    const expected = baseCounts();
    const actual = baseCounts();
    actual.tierPartition.cns5_plx = 3;
    const out = formatCountDiff(compareBuildCounts(expected, actual));
    expect(out).toMatch(
      /tierPartition\.cns5_plx\s+expected 0, got 3 \(\+3\)/,
    );
  });

  it('says "absent from snapshot" rather than printing a NaN delta', () => {
    const expected = baseCounts();
    const actual = baseCounts();
    delete (expected.tierPartition as Partial<Record<string, number>>).bailer_jones;
    const out = formatCountDiff(compareBuildCounts(expected, actual));
    expect(out).toMatch(
      /tierPartition\.bailer_jones\s+absent from snapshot, got 58/,
    );
    expect(out).not.toMatch(/NaN/);
  });

  it('says "absent from build" for a count the build stopped producing', () => {
    const expected = baseCounts();
    const actual = baseCounts();
    delete (actual as Partial<FixtureCounts>).gcvsMatched;
    const out = formatCountDiff(compareBuildCounts(expected, actual));
    expect(out).toMatch(/1 of \d+ counts differ/);
    expect(out).toMatch(/gcvsMatched\s+expected 3677, absent from build/);
  });
});

describe('compareCountSnapshot', () => {
  it('is clean only when every row matches', () => {
    expect(compareCountSnapshot(baseCounts(), baseCounts()).drifted).toBe(false);
  });

  it('drifts on a count missing from either side', () => {
    const full = baseCounts();
    const short = baseCounts();
    delete (short as Partial<FixtureCounts>).gcvsMatched;
    expect(compareCountSnapshot(full, short).drifted).toBe(true);
    expect(compareCountSnapshot(short, full).drifted).toBe(true);
  });

  it('compares a staged snapshot by its counts, the stage level dropped', () => {
    const staged = { stages: { read: { rows: 3 }, filter: { kept: 2, tiers: { a: 1 } } } };
    expect(compareCountSnapshot<object>(staged, { rows: 3, kept: 2, tiers: { a: 1 } }).drifted).toBe(false);
    expect(compareBuildCounts<object>(staged, { stages: { read: { rows: 4 }, filter: { kept: 2, tiers: { a: 1 } } } }))
      .toContainEqual({ key: 'rows', status: 'mismatch', expected: 3, actual: 4 });
  });

  it('drifts on a count filed under another stage at the same value, every row of a partition', () => {
    const staged = { stages: { read: { rows: 3 }, filter: { kept: 2, tiers: { a: 1 } } } };
    const moved = { stages: { read: { rows: 3, tiers: { a: 1 } }, filter: { kept: 2 } } };
    const diff = compareBuildCounts<object>(staged, moved);
    expect(driftedRows(diff)).toEqual([{ key: 'tiers.a', status: 'moved', value: 1, from: 'filter', to: 'read' }]);
    expect(formatCountDiff(diff)).toContain('tiers.a 1 moved from stage filter to read');
  });

  it('drifts on a stage whose input went absent as one row, not a row per count it held', () => {
    const counted = { stages: { read: { rows: 3 }, filter: { kept: 2, tiers: { a: 1 } } } };
    const absent = { stages: { read: { rows: 3 }, filter: 'absent' } };
    expect(driftedRows(compareBuildCounts<object>(counted, absent)))
      .toEqual([{ key: 'filter', status: 'absent-input', side: 'build' }]);
    expect(driftedRows(compareBuildCounts<object>(absent, counted)))
      .toEqual([{ key: 'filter', status: 'absent-input', side: 'snapshot' }]);
    expect(formatCountDiff(compareBuildCounts<object>(counted, absent)))
      .toContain("filter stage's input is absent from the build, counted in the snapshot");
    expect(compareCountSnapshot<object>(absent, absent).drifted).toBe(false);
  });
});

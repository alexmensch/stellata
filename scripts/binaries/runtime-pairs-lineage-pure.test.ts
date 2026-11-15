import { describe, expect, it } from 'vitest';

import { NO_PARENT } from '../../src/catalog-format/binaries/binaries-format';
import { SEEDED_BRANCH, seededCodeCheck } from '../catalog/lineage/count-block-fixture';
import { invariantViolations } from '../catalog/lineage/lineage-invariant-pure';
import { decodeLineageLine, foldStageLines } from '../catalog/lineage/lineage-row-pure';
import { resolvePairs } from '../catalog/companions/record-index/pair-resolution-pure';
import { pair } from './pair-fixture';
import type { MultiplesPair } from './pairs-pure';
import { planRecords } from './runtime-binaries-pure';
import { RUNTIME_PAIRS_CODES, RUNTIME_PAIRS_INVARIANTS, runtimePairsLineageLines } from './runtime-pairs-lineage-pure';

const MAP = { byGaia: { 1: 100, 2: 320 }, byHip: {}, bySynth: {} };

function lines(pairs: MultiplesPair[]) {
  const { fates } = planRecords(
    pairs, pairs.map(() => NO_PARENT), pairs.map((_, i) => i), resolvePairs(pairs, MAP).map((r) => r.rendered),
  );
  return runtimePairsLineageLines(pairs, fates);
}

describe('runtimePairsLineageLines', () => {
  it('writes one row per pair, keyed on its secondary row, a dropped duplicate citing the kept pair', () => {
    const rows = lines([pair('00000+0000-AC'), pair('00000+0000-BC'), pair('00000+0000-DE', { secondaryGaia: '999' })])
      .map(decodeLineageLine);
    expect(rows.map((r) => [r.key, r.code, r.evidence])).toEqual([
      ['multiples:00000+0000-AC/C', 'runtime-pairs.emitted', []],
      ['multiples:00000+0000-BC/C', 'runtime-pairs.dropped.duplicate-relation', ['multiples:00000+0000-AC/C']],
      ['multiples:00000+0000-DE/E', 'runtime-pairs.dropped.secondary-unresolved', []],
    ]);
  });

  it('folds into a count block every code reaches', () => {
    expect(foldStageLines(RUNTIME_PAIRS_CODES, lines([pair('00000+0000-AB'), pair('00000+0000-Aa,B')]))).toMatchObject({
      'runtime-pairs.emitted': 1, 'runtime-pairs.dropped.same-relation-alias': 1, 'runtime-pairs.dropped.duplicate-relation': 0,
    });
    const { drift, refreshed } = seededCodeCheck(RUNTIME_PAIRS_CODES, lines([pair()]));
    expect(drift.report).toContain(`runtime-pairs.${SEEDED_BRANCH}`);
    expect(refreshed.drifted).toBe(false);
  });

  it('a duplicate relation the invariant does not name fails it by key', () => {
    const [v] = invariantViolations(RUNTIME_PAIRS_INVARIANTS, lines([pair('00000+0000-AC'), pair('00000+0000-BC')]));
    expect(v.rows.map((r) => r.key)).toEqual(['multiples:00000+0000-BC/C']);
  });
});

import { describe, expect, it } from 'vitest';

import {
  ABSENT_STAGE, absentStages, flattenStages, isStaged, nestByStage, stageOfCounts, type CountValue, type StageBlock,
} from './count-stages-pure';

type Block = StageBlock<'read' | 'filter' | 'write', CountValue>;

describe('util/count-stages', () => {
  const order = ['read', 'filter', 'write'] as const;
  const blocks: readonly Block[] = [
    { stage: 'filter', block: { kind: 'counted', counts: { kept: 2, tiers: { a: 1, b: 0 } } } },
    { stage: 'read', block: { kind: 'counted', counts: { rows: 3 } } },
  ];
  const flat = { rows: 3, kept: 2, tiers: { a: 1, b: 0 } };

  it('nests each block under its stage, stages in the declared order', () => {
    expect(JSON.stringify(nestByStage(order, blocks))).toBe(JSON.stringify({
      stages: { read: { rows: 3 }, filter: { kept: 2, tiers: { a: 1, b: 0 } } },
    }));
  });

  it('leaves out a declared stage no block reaches, and an empty block', () => {
    const empty: Block = { stage: 'write', block: { kind: 'counted', counts: {} } };
    expect(Object.keys(nestByStage(order, [...blocks, empty]).stages)).toEqual(['read', 'filter']);
  });

  it('flattens a staged snapshot back to the same keys and values', () => {
    expect(flattenStages(nestByStage(order, blocks))).toEqual(flat);
  });

  it('leaves a flat snapshot as it is, partition-valued keys included', () => {
    expect(flattenStages(flat)).toBe(flat);
    expect(isStaged({ stages: 3 })).toBe(false);
    expect(isStaged({ stages: {}, rows: 1 })).toBe(false);
  });

  it('refuses a key two stages share', () => {
    expect(() => flattenStages({ stages: { read: { rows: 1 }, filter: { rows: 2 } } }))
      .toThrow('count rows is under two stages, read and filter');
  });

  it('composes a derived stage right after its own', () => {
    const derived: readonly Block[] = [
      { stage: 'filter-derived', block: { kind: 'counted', counts: { groups: 1 } } },
      { stage: 'write', block: { kind: 'counted', counts: { 'write.done': 2 } } },
      { stage: 'read', block: { kind: 'counted', counts: { rows: 3 } } },
    ];
    expect(JSON.stringify(nestByStage(order, derived))).toBe(JSON.stringify({
      stages: { read: { rows: 3 }, 'filter-derived': { groups: 1 }, write: { 'write.done': 2 } },
    }));
  });

  it('files an absent block as the absent marker, which flattens to no key', () => {
    const nested = nestByStage(order, [...blocks, { stage: 'write', block: { kind: 'absent' } }]);
    expect(nested.stages.write).toBe(ABSENT_STAGE);
    expect(absentStages(nested)).toEqual(new Set(['write']));
    expect(flattenStages(nested)).toEqual(flat);
    expect(stageOfCounts(nested)?.has('write')).toBe(false);
  });

  it('refuses a block for an undeclared stage, and a stage composed twice', () => {
    const counted = { kind: 'counted', counts: {} } as const;
    expect(() => nestByStage(['read'], [{ stage: 'other' as 'read', block: counted }]))
      .toThrow('count block other is not a declared stage');
    expect(() => nestByStage(['read'], [{ stage: 'read', block: counted }, { stage: 'read', block: counted }]))
      .toThrow('count block read is composed twice');
  });
});

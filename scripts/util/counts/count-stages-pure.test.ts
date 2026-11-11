import { describe, expect, it } from 'vitest';

import { ABSENT_STAGE, absentStages, flattenStages, isStaged, nestByStage, stageOfCounts } from './count-stages-pure';

describe('util/count-stages', () => {
  const flat = { rows: 3, kept: 2, tiers: { a: 1, b: 0 } };
  const stages = { order: ['read', 'filter', 'write'], of: { kept: 'filter', rows: 'read', tiers: 'filter' } } as const;

  it('nests each key under its stage, stages in the declared order and keys in the flat order', () => {
    expect(JSON.stringify(nestByStage(flat, stages))).toBe(JSON.stringify({
      stages: { read: { rows: 3 }, filter: { kept: 2, tiers: { a: 1, b: 0 } } },
    }));
  });

  it('leaves out a declared stage no key reaches', () => {
    expect(Object.keys(nestByStage(flat, stages).stages)).toEqual(['read', 'filter']);
  });

  it('flattens a staged snapshot back to the same keys and values', () => {
    expect(flattenStages(nestByStage(flat, stages))).toEqual(flat);
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

  it('refuses a key with no stage', () => {
    const extra = { ...flat, stray: 1 } as typeof flat;
    expect(() => nestByStage(extra, stages)).toThrow('count stray has no stage');
  });

  it('composes each block under its own stage, a derived stage right after its own', () => {
    const blocks = [
      { stage: 'filter-derived', block: { kind: 'counted', counts: { groups: 1 } } },
      { stage: 'write', block: { kind: 'counted', counts: { 'write.done': 2 } } },
    ] as const;
    const { rows } = flat;
    expect(JSON.stringify(nestByStage({ rows }, { order: stages.order, of: { rows: 'read' } }, blocks))).toBe(JSON.stringify({
      stages: { read: { rows: 3 }, 'filter-derived': { groups: 1 }, write: { 'write.done': 2 } },
    }));
  });

  it('files an absent block as the absent marker, which flattens to no key', () => {
    const nested = nestByStage(flat, stages, [{ stage: 'write', block: { kind: 'absent' } }]);
    expect(nested.stages.write).toBe(ABSENT_STAGE);
    expect(absentStages(nested)).toEqual(new Set(['write']));
    expect(flattenStages(nested)).toEqual(flat);
    expect(stageOfCounts(nested)?.has('write')).toBe(false);
  });

  it('refuses a block for an undeclared stage, a stage composed twice, and a flat key filed under a composed stage', () => {
    const counted = { kind: 'counted', counts: {} } as const;
    expect(() => nestByStage({}, { order: ['read'], of: {} }, [{ stage: 'other' as 'read', block: counted }]))
      .toThrow('count block other is not a declared stage');
    expect(() => nestByStage({}, { order: ['read'], of: {} }, [{ stage: 'read', block: counted }, { stage: 'read', block: counted }]))
      .toThrow('count block read is composed twice');
    expect(() => nestByStage(flat, stages, [{ stage: 'filter', block: counted }]))
      .toThrow('count kept is filed under filter, which a count block composes');
  });

  it('refuses a stage outside the declared order', () => {
    const undeclared = { order: ['read'], of: { rows: 'read', kept: 'filter', tiers: 'filter' } } as unknown as typeof stages;
    expect(() => nestByStage(flat, undeclared)).toThrow('count kept is filed under filter, which is not a declared stage');
  });
});

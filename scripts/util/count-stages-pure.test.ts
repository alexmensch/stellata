import { describe, expect, it } from 'vitest';

import { flattenStages, isStaged, nestByStage } from './count-stages-pure';

describe('util/count-stages', () => {
  const flat = { rows: 3, kept: 2, tiers: { a: 1, b: 0 } };
  const stageOf = { kept: 'filter', rows: 'read', tiers: 'filter' } as const;

  it('nests each key under its stage, stages in the table order and keys in the flat order', () => {
    const staged = nestByStage(flat, stageOf);
    expect(JSON.stringify(staged)).toBe(JSON.stringify({
      stages: { filter: { kept: 2, tiers: { a: 1, b: 0 } }, read: { rows: 3 } },
    }));
  });

  it('flattens a staged snapshot back to the same keys and values', () => {
    expect(flattenStages(nestByStage(flat, stageOf))).toEqual(flat);
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
    expect(() => nestByStage(extra, stageOf)).toThrow('count stray has no stage');
  });
});

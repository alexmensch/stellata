import { describe, expect, it } from 'vitest';
import {
  INDIRECT_ARGS_STRIDE, INDIRECT_INSTANCE_COUNT_SLOT, STAR_TIERS, STAR_TIER_DISC, STAR_TIER_GLOW,
  initialIndirectArgs, tierArgsInstanceCountElement, tierArgsOffsetBytes, tierListBase,
} from './compaction-pure';

describe('compaction layout', () => {
  it('two tiers, glow first', () => {
    expect(STAR_TIERS).toEqual([STAR_TIER_GLOW, STAR_TIER_DISC]);
  });

  it('lists sit back to back, one catalogue count each', () => {
    expect(tierListBase(STAR_TIER_GLOW, 388071)).toBe(0);
    expect(tierListBase(STAR_TIER_DISC, 388071)).toBe(388071);
  });

  // drawIndexedIndirect reads five u32: indexCount, instanceCount,
  // firstIndex, baseVertex, firstInstance.
  it('one five-u32 args slot per tier, instanceCount second', () => {
    expect(INDIRECT_ARGS_STRIDE).toBe(5);
    expect(INDIRECT_INSTANCE_COUNT_SLOT).toBe(1);
    expect(tierArgsInstanceCountElement(STAR_TIER_GLOW)).toBe(1);
    expect(tierArgsInstanceCountElement(STAR_TIER_DISC)).toBe(6);
    expect(tierArgsOffsetBytes(STAR_TIER_GLOW)).toBe(0);
    expect(tierArgsOffsetBytes(STAR_TIER_DISC)).toBe(20);
  });

  it('the initial args draw the quad over zero instances in both slots', () => {
    expect(Array.from(initialIndirectArgs(6))).toEqual([6, 0, 0, 0, 0, 6, 0, 0, 0, 0]);
  });
});

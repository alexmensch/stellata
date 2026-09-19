import { describe, expect, it } from 'vitest';
import { REFILL_SLICES } from '../../extinction/refill/refill-slices-pure';
import {
  ARGS_ELEMENTS, CULL_SLACK_NDC, INDIRECT_ARGS_STRIDE, INDIRECT_INSTANCE_COUNT_SLOT,
  PREFILTER_COUNT_ELEMENT, REFILL_DISPATCH_ELEMENTS, REFILL_DISPATCH_LENGTH_ELEMENT,
  REFILL_LIST_COUNT_BASE, STAR_TIERS, STAR_TIER_DISC, STAR_TIER_GLOW, initialIndirectArgs,
  initialRefillDispatch, refillListCountElement, starQuadOffscreen, survivorCountsFromArgs,
  tierArgsInstanceCountElement, tierArgsOffsetBytes, tierListBase,
} from './compaction-pure';

describe('starQuadOffscreen', () => {
  const W = 1600;
  const H = 900;

  it('keeps a star anywhere inside the clip box', () => {
    expect(starQuadOffscreen(0, 0, 1, 4, W, H)).toBe(false);
    expect(starQuadOffscreen(0.99, -0.99, 1, 4, W, H)).toBe(false);
    expect(starQuadOffscreen(1.98, 0, 2, 4, W, H)).toBe(false);
  });

  it('culls a star behind the camera whatever its screen position', () => {
    expect(starQuadOffscreen(0, 0, 0, 4, W, H)).toBe(true);
    expect(starQuadOffscreen(0, 0, -1, 4, W, H)).toBe(true);
  });

  // The quad reaches pxSize / viewport past its centre in NDC, so a centre
  // just outside the box still draws if the quad overlaps the edge.
  it('keeps a centre past the edge by less than the quad half-extent, culls one past it', () => {
    const px = 160;
    const half = px / W;
    expect(starQuadOffscreen(1 + half * 0.9, 0, 1, px, W, H)).toBe(false);
    expect(starQuadOffscreen(1 + half * 1.1, 0, 1, px, W, H)).toBe(true);
    expect(starQuadOffscreen(0, -(1 + px / H) * 1.1, 1, px, W, H)).toBe(true);
  });

  it('a large disc survives from far outside where a point would not', () => {
    expect(starQuadOffscreen(1.3, 0, 1, 1, W, H)).toBe(true);
    expect(starQuadOffscreen(1.3, 0, 1, 0.4 * W, W, H)).toBe(false);
  });

  it('the slack is sub-pixel at the pin viewport and holds the boundary case', () => {
    expect(CULL_SLACK_NDC * W / 2).toBeLessThan(0.1);
    expect(starQuadOffscreen(1 + CULL_SLACK_NDC * 0.5, 0, 1, 0, W, H)).toBe(false);
    expect(starQuadOffscreen(1 + CULL_SLACK_NDC * 2, 0, 1, 0, W, H)).toBe(true);
  });
});

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

  it('the initial args draw the quad over zero instances in both slots, every counter zero', () => {
    expect(Array.from(initialIndirectArgs(6)))
      .toEqual([6, 0, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  // The counters sit past both draw slots, so no indirect draw reads them.
  it('the prefilter counter is the element past the last draw slot', () => {
    expect(PREFILTER_COUNT_ELEMENT).toBe(10);
    expect(PREFILTER_COUNT_ELEMENT).toBeGreaterThanOrEqual(
      tierArgsOffsetBytes(STAR_TIER_DISC) / 4 + INDIRECT_ARGS_STRIDE);
  });

  it('one refill sub-list counter per quarter follows it, closing the buffer', () => {
    expect(REFILL_LIST_COUNT_BASE).toBe(11);
    expect(refillListCountElement(0)).toBe(11);
    expect(refillListCountElement(REFILL_SLICES - 1)).toBe(14);
    expect(ARGS_ELEMENTS).toBe(15);
  });

  // The readback takes the very slots the draws take their instance count
  // from, so a layout change cannot move one without moving the other.
  it('reads each tier count out of the slot that tier draws at', () => {
    const args = initialIndirectArgs(6);
    args[tierArgsInstanceCountElement(STAR_TIER_GLOW)] = 1234;
    args[tierArgsInstanceCountElement(STAR_TIER_DISC)] = 7;
    args[PREFILTER_COUNT_ELEMENT] = 5000;
    expect(survivorCountsFromArgs(args)).toEqual({ glow: 1234, disc: 7, prefilter: 5000 });
  });

  it('a short buffer reads zero rather than undefined', () => {
    expect(survivorCountsFromArgs(new Uint32Array(2))).toEqual({ glow: 0, disc: 0, prefilter: 0 });
  });

  // dispatchWorkgroupsIndirect reads three u32; y and z stay 1 so element 0
  // alone is the workgroup count the finish kernel writes. The listed length
  // rides past them, where the dispatch never looks.
  it('the refill dispatch starts at zero workgroups of one row, zero listed', () => {
    const initial = initialRefillDispatch();
    expect(initial).toHaveLength(REFILL_DISPATCH_ELEMENTS);
    expect(Array.from(initial)).toEqual([0, 1, 1, 0]);
    expect(REFILL_DISPATCH_LENGTH_ELEMENT).toBe(3);
  });
});

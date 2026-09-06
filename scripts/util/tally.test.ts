import { describe, expect, it } from 'vitest';

import {
  DIRECTION_VIA_VALUES,
  VELOCITY_VIA_VALUES,
} from '../catalog/distance/direction-cascade';
import { DIST_VIA_VALUES } from '../catalog/distance/parallax/parallax-cascade';
import { V_VIA_VALUES } from '../catalog/photometry/v-magnitude-pure';
import { emptyTallyPartition } from './tally';

describe('util/tally / emptyTallyPartition', () => {
  it('zeroes one bucket per declared value', () => {
    expect(emptyTallyPartition(['a', 'b'] as const)).toEqual({ a: 0, b: 0 });
  });

  it('yields an empty partition for an empty tuple', () => {
    expect(emptyTallyPartition([])).toEqual({});
  });

  // Each cascade's partition must carry exactly the tiers its own tuple
  // declares: a tier tallied onto an absent key increments `undefined`, and the
  // resulting NaN reaches the pinned build snapshot as a hole rather than a
  // drift failure. Pinning every cascade here is what makes the shared helper
  // safe to reuse for the next one.
  it.each([
    ['direction', DIRECTION_VIA_VALUES],
    ['velocity', VELOCITY_VIA_VALUES],
    ['V', V_VIA_VALUES],
    ['distance', DIST_VIA_VALUES],
  ])('covers every %s tier', (_label, values) => {
    const partition = emptyTallyPartition(values);
    expect(Object.keys(partition).sort()).toEqual([...values].sort());
    expect(Object.values(partition)).toEqual(values.map(() => 0));
  });
});

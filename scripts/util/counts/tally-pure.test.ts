import { describe, expect, it } from 'vitest';

import { DIRECTION_VIA_VALUES } from '../../catalog/distance/direction-cascade';
import { VELOCITY_VIA_VALUES } from '../../catalog/distance/velocity';
import { DIST_VIA_VALUES } from '../../../src/catalog-format/record/catalog-pure';
import { V_VIA_VALUES } from '../../catalog/photometry/v-magnitude-pure';
import { emptyTallyPartition, fold, formatPartition, prefixed, share, sumOf } from './tally-pure';

describe('util/tally / fold', () => {
  const OUTCOMES = ['kept', 'parked', 'dropped'] as const;

  it('counts each item under its key, every variant present', () => {
    expect(fold(OUTCOMES, ['kept', 'kept', 'parked'], (o) => o)).toEqual({ kept: 2, parked: 1, dropped: 0 });
  });

  it('folds through a key function', () => {
    const rows = [{ code: 'parked' }, { code: 'parked' }];
    expect(fold(OUTCOMES, rows, (r) => r.code)).toEqual({ kept: 0, parked: 2, dropped: 0 });
  });

  it('refuses an item outside the declared variants', () => {
    expect(() => fold(OUTCOMES, ['merged'], (o) => o)).toThrow(/"merged" is not one of the declared variants/);
  });

  it('types the result over the declared variants, so a snapshot keyed on a wider union fails to compile', () => {
    // @ts-expect-error — 'merged' is in the snapshot's union but no fold variant tallies it
    const snapshot: Record<(typeof OUTCOMES)[number] | 'merged', number> = fold(OUTCOMES, [], (o: string) => o);
    expect(snapshot).toEqual({ kept: 0, parked: 0, dropped: 0 });
  });
});

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

describe('util/tally / prefixed', () => {
  it('prefixes every key, values kept', () => {
    expect(prefixed('orbit_', fold(['msc', 'none'] as const, ['msc', 'msc'], (v) => v))).toEqual({ orbit_msc: 2, orbit_none: 0 });
  });
});

describe('util/tally / sumOf', () => {
  it('sums only the named members under the prefix', () => {
    const counts = { orbit_msc: 2, orbit_orb6: 3, orbit_none: 7 };
    expect(sumOf(counts, 'orbit_', ['msc', 'orb6'] as const)).toBe(5);
  });
});

describe('util/tally / share', () => {
  it('divides, and throws on an empty whole rather than calling it 0', () => {
    expect(share(1, 4, 'r')).toBe(0.25);
    expect(() => share(0, 0, 'nss_orbit_rate')).toThrow(/nss_orbit_rate: nothing to rate/);
  });
});

describe('formatPartition', () => {
  it('lists every bucket in declaration order, zeros included', () => {
    expect(formatPartition({ bailer_jones: 58, gaia_dr3_inversion: 2, curated: 0 })).toBe(
      'bailer_jones=58, gaia_dr3_inversion=2, curated=0',
    );
  });
});

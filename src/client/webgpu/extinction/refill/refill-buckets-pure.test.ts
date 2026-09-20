import { describe, expect, it } from 'vitest';
import {
  REFILL_BUCKETS, refillBucketAt, refillBucketBase, refillBucketCapacity, refillBucketOf,
  refillBucketPrefix, refillWorklistLength,
} from './refill-buckets-pure';

describe('the Morton-range partition', () => {
  it('is a power of two, which is what lets the kernel search without a bound test', () => {
    expect(REFILL_BUCKETS).toBe(256);
    expect(Math.log2(REFILL_BUCKETS) % 1).toBe(0);
  });

  it('cuts the slot space into REFILL_BUCKETS ranges, rounding up', () => {
    expect(refillBucketCapacity(1024, 256)).toBe(4);
    expect(refillBucketCapacity(1025, 256)).toBe(5);
    expect(refillBucketCapacity(388_071)).toBe(1516);
    expect(refillBucketCapacity(1_278_785)).toBe(4996);
  });

  it('never returns zero', () => {
    expect(refillBucketCapacity(0, 256)).toBe(1);
    expect(refillBucketCapacity(3, 0)).toBe(3);
  });

  // The capacity argument: a bucket spans exactly `capacity` Morton slots and
  // a star occupies one, so no build can overflow it whatever the gate admits.
  it.each([1, 5, 1024, 1025, 388_071, 1_278_785])('a bucket spans exactly its capacity in slots at %i', (count) => {
    const capacity = refillBucketCapacity(count);
    for (let b = 0; b < REFILL_BUCKETS; b++) {
      const first = b * capacity;
      if (first >= count) break;
      expect(refillBucketOf(first, count)).toBe(b);
      expect(refillBucketOf(first + capacity - 1, count)).toBe(b);
      expect(refillBucketOf(first + capacity, count)).toBe(b + 1);
    }
    expect(refillBucketOf(count - 1, count)).toBeLessThan(REFILL_BUCKETS);
  });

  it('lays the buckets back to back, and the whole list holds every one at capacity', () => {
    expect(refillBucketBase(0, 1025, 256)).toBe(0);
    expect(refillBucketBase(1, 1025, 256)).toBe(5);
    expect(refillBucketBase(255, 1025, 256)).toBe(1275);
    expect(refillWorklistLength(1025, 256)).toBe(1280);
    expect(refillWorklistLength(388_071)).toBe(388_096);
  });
});

describe('the scan and the search the kernels run', () => {
  it('the prefix is exclusive and carries the total last', () => {
    expect(refillBucketPrefix([3, 0, 2])).toEqual([0, 3, 3, 5]);
    expect(refillBucketPrefix([])).toEqual([0]);
  });

  // The search must skip an empty bucket: its prefix equals its successor's,
  // so the LARGEST bucket whose prefix i has reached is the one holding it.
  it('lands every dense index on the bucket that holds it, empties included', () => {
    const counts = Array.from({ length: REFILL_BUCKETS }, (_, b) => (b % 3 === 0 ? 0 : b % 7));
    const prefix = refillBucketPrefix(counts);
    const total = prefix[REFILL_BUCKETS];
    expect(total).toBeGreaterThan(0);
    for (let i = 0; i < total; i++) {
      const bucket = refillBucketAt(prefix, i);
      expect(counts[bucket]).toBeGreaterThan(0);
      expect(prefix[bucket]).toBeLessThanOrEqual(i);
      expect(i - prefix[bucket]).toBeLessThan(counts[bucket]);
    }
  });

  it('reads the dense list back in bucket order, which is Morton order coarsened', () => {
    const counts = [2, 0, 3, 1, ...new Array<number>(REFILL_BUCKETS - 4).fill(0)];
    const prefix = refillBucketPrefix(counts);
    const visited = Array.from({ length: prefix[REFILL_BUCKETS] }, (_, i) => refillBucketAt(prefix, i));
    expect(visited).toEqual([0, 0, 2, 2, 2, 3]);
  });
});

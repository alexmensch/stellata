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

/** The producer composes a write address from its bucket and its atomic's
 *  return; the refill kernel composes a read address from its search and the
 *  prefix. Nothing else pins that the two agree. */
describe('the producer writes where the refill kernel reads', () => {
  const march = (count: number, admit: (star: number) => boolean) => {
    const slotOf = Array.from({ length: count }, (_, s) => (s * 613 + 11) % count);
    const admitted = Array.from({ length: count }, (_, s) => s).filter(admit);

    // Producer: one atomic per bucket, the star landing in that bucket's
    // static region at the offset the atomic returned.
    const region = new Map<number, number>();
    const counts = new Array<number>(REFILL_BUCKETS).fill(0);
    for (const star of admitted) {
      const bucket = refillBucketOf(slotOf[star], count);
      region.set(refillBucketBase(bucket, count) + counts[bucket]++, star);
    }

    // Consumer: the scan, then one thread per dense index.
    const prefix = refillBucketPrefix(counts);
    const marched = Array.from({ length: prefix[REFILL_BUCKETS] }, (_, i) => {
      const bucket = refillBucketAt(prefix, i);
      return region.get(refillBucketBase(bucket, count) + (i - prefix[bucket]));
    });
    return { admitted, counts, marched, slotOf };
  };

  it('recovers exactly the appended stars, and marches them in bucket order', () => {
    const count = 1025;
    const { admitted, marched, slotOf } = march(count, (s) => s % 7 === 0);
    expect(marched).not.toContain(undefined);
    expect(new Set(marched)).toEqual(new Set(admitted));
    const buckets = marched.map((s) => refillBucketOf(slotOf[s as number], count));
    expect(buckets).toEqual([...buckets].sort((a, b) => a - b));
  });

  // The whole catalogue admitted is the case the capacity argument covers:
  // no gate, camera or residue class can put more stars in a bucket than it
  // has slots, so overflow is not a case the kernels handle.
  it.each([1025, 388_071, 1_278_785])('holds every star at %i without overflowing a bucket', (count) => {
    const { admitted, counts, marched } = march(count, () => true);
    expect(Math.max(...counts)).toBeLessThanOrEqual(refillBucketCapacity(count));
    expect(marched).toHaveLength(admitted.length);
    expect(new Set(marched).size).toBe(count);
  });
});

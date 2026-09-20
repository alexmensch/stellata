// The Morton-range partition the worklist is appended under, and the
// exclusive prefix that packs the buckets back into one dense dispatch.
// README.md § Bucketed by Morton range.

/** Buckets the slot space is cut into. A power of two: the refill kernel's
 *  search walks one bit per step from `REFILL_BUCKETS / 2` and never needs a
 *  bound test (README.md § Bucketed by Morton range). */
export const REFILL_BUCKETS = 256;

/** Slots per bucket, which is also the bucket's capacity: a bucket spans
 *  exactly this many Morton slots and no star occupies two. */
export function refillBucketCapacity(count: number, buckets: number = REFILL_BUCKETS): number {
  return Math.max(1, Math.ceil(count / Math.max(1, buckets)));
}

export function refillBucketOf(
  slot: number, count: number, buckets: number = REFILL_BUCKETS,
): number {
  return Math.floor(slot / refillBucketCapacity(count, buckets));
}

/** The whole worklist: every bucket at capacity, one region shared by all
 *  quarters (README.md § One region, and the frame order behind it). */
export function refillWorklistLength(count: number, buckets: number = REFILL_BUCKETS): number {
  return Math.max(1, buckets) * refillBucketCapacity(count, buckets);
}

export function refillBucketBase(
  bucket: number, count: number, buckets: number = REFILL_BUCKETS,
): number {
  return bucket * refillBucketCapacity(count, buckets);
}

/** CPU mirror of the finish kernel's scan: element `b` is how many stars the
 *  buckets before `b` hold, and the return's last element the total. */
export function refillBucketPrefix(counts: readonly number[]): number[] {
  const prefix: number[] = [];
  let running = 0;
  for (const n of counts) {
    prefix.push(running);
    running += n;
  }
  prefix.push(running);
  return prefix;
}

/** CPU mirror of the refill kernel's search: the bucket holding dense index
 *  `i`, given the exclusive prefix. */
export function refillBucketAt(prefix: readonly number[], i: number, buckets = REFILL_BUCKETS): number {
  let bucket = 0;
  for (let step = buckets >> 1; step >= 1; step >>= 1) {
    const next = bucket + step;
    if ((prefix[next] ?? Infinity) <= i) bucket = next;
  }
  return bucket;
}

// Zeroed counting partitions over a closed string-literal tuple.

/** A zeroed bucket per member of `values`, typed to exactly those keys.
 *
 *  Every routing cascade in the catalog build tallies per-tier counts this way
 *  (direction, velocity, V, dist_src). Deriving the buckets from the tuple that
 *  DEFINES the tier set is what stops a newly-added tier from tallying onto an
 *  absent key — `undefined + 1` is NaN, and a NaN reaches the pinned snapshot
 *  as a silent hole rather than a drift failure. */
export function emptyTallyPartition<T extends string>(
  values: readonly T[],
): Record<T, number> {
  return Object.fromEntries(values.map((v) => [v, 0])) as Record<T, number>;
}

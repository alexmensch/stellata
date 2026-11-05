// Counting partitions over a closed string-literal tuple: the zeroed record and the fold into it. See README.md (tally-pure.ts entry).

/** A zeroed bucket per member of `values`, typed to exactly those keys. */
export function emptyTallyPartition<T extends string>(
  values: readonly T[],
): Record<T, number> {
  return Object.fromEntries(values.map((v) => [v, 0])) as Record<T, number>;
}

/** How many of `items` fall in each of `variants`, every variant present,
 *  zeros included. An item whose key is not a declared variant throws. */
export function fold<T extends string, I>(
  variants: readonly T[],
  items: Iterable<I>,
  key: (item: I) => string,
): Record<T, number> {
  const tally: Record<string, number> = emptyTallyPartition(variants);
  for (const item of items) {
    const k = key(item);
    if (!Object.hasOwn(tally, k)) {
      throw new Error(`tally: "${k}" is not one of the declared variants ${variants.join(', ')}`);
    }
    tally[k]++;
  }
  return tally as Record<T, number>;
}

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

/** A tally's keys under a snapshot prefix: `prefixed('orbit_', {msc: 3})` is `{orbit_msc: 3}`. */
export function prefixed<P extends string, K extends string>(prefix: P, tally: Record<K, number>): Record<`${P}${K}`, number> {
  return Object.fromEntries(Object.entries(tally).map(([k, v]) => [`${prefix}${k}`, v])) as Record<`${P}${K}`, number>;
}

/** The sum of `members`' counts under a snapshot prefix: `sumOf(counts, 'orbit_', ['msc', 'orb6'])`. */
export function sumOf<P extends string, K extends string>(counts: Record<`${P}${K}`, number>, prefix: P, members: readonly K[]): number {
  return members.reduce((n, m) => n + counts[`${prefix}${m}`], 0);
}

/** `part / whole` for a snapshot rate; throws on an empty whole, which is a
 *  broken build, not a rate of 0. */
export function share(part: number, whole: number, rate: string): number {
  if (whole <= 0) throw new Error(`${rate}: nothing to rate (denominator ${whole})`);
  return part / whole;
}

/** One-line `bucket=n` rundown of a row partition, zeros included — the
 *  per-partition dry-run figure an override PR quotes. */
export function formatPartition(partition: Readonly<Record<string, number>>): string {
  return Object.entries(partition).map(([b, n]) => `${b}=${n}`).join(', ');
}

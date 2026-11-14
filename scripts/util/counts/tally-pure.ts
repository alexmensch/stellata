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

/** A tally's keys renamed to snapshot keys: `renamed({msc: 'orbitMsc'}, {msc: 3})` is `{orbitMsc: 3}`. */
export function renamed<K extends string, const M extends Record<K, string>>(names: M, tally: Record<K, number>): Record<M[K], number> {
  return Object.fromEntries(Object.entries(tally).map(([k, v]) => [names[k as K], v])) as Record<M[K], number>;
}

/** The sum of `members`' counts under a snapshot prefix: `sumOf(counts, 'orbit_', ['msc', 'orb6'])`. */
export function sumOf<P extends string, K extends string>(counts: Record<`${P}${K}`, number>, prefix: P, members: readonly K[]): number {
  return members.reduce((n, m) => n + counts[`${prefix}${m}`], 0);
}

export type Share = { kind: 'rated'; value: number } | { kind: 'no-denominator' };

/** `part / whole`, or `no-denominator` for an empty whole — never a rate of 0. */
export function share(part: number, whole: number): Share {
  return whole === 0 ? { kind: 'no-denominator' } : { kind: 'rated', value: part / whole };
}

/** A fraction as a percentage, one decimal unless `digits` says otherwise: `formatFraction(0.125)` is `12.5%`. */
export function formatFraction(v: number, digits = 1): string {
  return `${(100 * v).toFixed(digits)}%`;
}

export const NO_FIGURE = 'n/a';

/** A share as a percentage through `formatFraction`, `NO_FIGURE` when it has no denominator. */
export function formatShare(s: Share, digits = 1): string {
  return s.kind === 'no-denominator' ? NO_FIGURE : formatFraction(s.value, digits);
}

/** `part` as a percentage of `whole` through `formatShare`, `n/a` for an empty whole. */
export function percentOf(part: number, whole: number, digits = 1): string {
  return formatShare(share(part, whole), digits);
}

export type FloorVerdict = 'meets' | 'under' | 'no-denominator';

/** A share against `floor`. A share with no denominator never meets it: an
 *  empty population is the drift a coverage floor exists to catch. */
export function floorVerdict(s: Share, floor: number): FloorVerdict {
  if (s.kind === 'no-denominator') return 'no-denominator';
  return s.value >= floor ? 'meets' : 'under';
}

/** One-line `bucket=n` rundown of a row partition, zeros included — the
 *  per-partition dry-run figure an override PR quotes. */
export function formatPartition(partition: Readonly<Record<string, number>>): string {
  return Object.entries(partition).map(([b, n]) => `${b}=${n}`).join(', ');
}

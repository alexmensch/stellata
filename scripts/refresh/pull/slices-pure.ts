// A table partitioned into half-open key ranges between committed edges, open at both ends. See README.md#sliced-scope.

/** An integer key's edges are bigints, so a source_id past 2^53 stays exact; a decimal key's are numbers. */
export type SliceKey = bigint | number;

export type SliceEdges = readonly [bigint, ...bigint[]] | readonly [number, ...number[]];

function literal(edge: SliceKey): string {
  if (typeof edge === 'number' && !Number.isFinite(edge)) throw new Error(`a slice edge must be finite: ${edge}`);
  return String(edge);
}

/** One ADQL condition per slice: `key < e0`, `e(i-1) <= key < e(i)`, …, `key >= e(n-1)`. Every non-null key falls in exactly one. */
export function sliceConditions(key: string, edges: SliceEdges): string[] {
  const at = (edges as readonly SliceKey[]).map(literal);
  edges.forEach((edge: SliceKey, i: number) => {
    if (i > 0 && edge <= edges[i - 1]) throw new Error(`slice edges must strictly increase: ${at[i - 1]} then ${at[i]}`);
  });
  return [
    `${key} < ${at[0]}`,
    ...at.slice(1).map((edge, i) => `${key} >= ${at[i]} AND ${key} < ${edge}`),
    `${key} >= ${at[at.length - 1]}`,
  ];
}

/** How many of `keys` each slice holds, in slice order. */
export function sliceCounts<T extends SliceKey>(keys: Iterable<T>, edges: readonly T[]): number[] {
  const counts = new Array<number>(edges.length + 1).fill(0);
  for (const key of keys) {
    let lo = 0;
    let hi = edges.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (key < edges[mid]) hi = mid;
      else lo = mid + 1;
    }
    counts[lo]++;
  }
  return counts;
}

/** The edges that cut ascending `sorted` into slices of at most `sliceRows` each; equal keys never straddle an edge. */
export function cutEdges<T extends SliceKey>(sorted: readonly T[], sliceRows: number): T[] {
  const edges: T[] = [];
  let start = 0;
  while (sorted.length - start > sliceRows) {
    let cut = start + sliceRows;
    while (cut > start && sorted[cut - 1] === sorted[cut]) cut--;
    if (cut === start) throw new Error(`more than ${sliceRows} rows share the key ${sorted[start]}`);
    edges.push(sorted[cut]);
    start = cut;
  }
  return edges;
}

// A table partitioned into half-open key ranges between committed edges, open at both ends. See README.md#sliced-scope.

/** One ADQL condition per slice: `key < e0`, `e(i-1) <= key < e(i)`, …, `key >= e(n-1)`. Every non-null key falls in exactly one. */
export function sliceConditions(key: string, edges: readonly [bigint, ...bigint[]]): string[] {
  edges.forEach((edge, i) => {
    if (i > 0 && edge <= edges[i - 1]) throw new Error(`slice edges must strictly increase: ${edges[i - 1]} then ${edge}`);
  });
  return [
    `${key} < ${edges[0]}`,
    ...edges.slice(1).map((edge, i) => `${key} >= ${edges[i]} AND ${key} < ${edge}`),
    `${key} >= ${edges[edges.length - 1]}`,
  ];
}

/** How many of `keys` each slice holds, in slice order. */
export function sliceCounts(keys: Iterable<bigint>, edges: readonly bigint[]): number[] {
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
export function cutEdges(sorted: readonly bigint[], sliceRows: number): bigint[] {
  const edges: bigint[] = [];
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

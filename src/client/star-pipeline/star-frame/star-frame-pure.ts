// The Sol-distance proximity index's in-place merge.
// See ./README.md § Absorbing a chunk.

import { sortIndicesByKeyWords } from '../../util/radix-sort';

/** `key` holds `Infinity` past `end` on entry and on exit, and `dist` is
 *  non-negative (`+Infinity` allowed) — ./README.md § Absorbing a chunk. */
export function mergeSortedByDistance(
  dist: Float32Array,
  idx: Uint32Array,
  key: Float32Array,
  first: number,
  end: number,
): void {
  if (end <= first) return;
  const incoming = sortIndicesByKeyWords(
    [new Uint32Array(dist.buffer, dist.byteOffset, dist.length)], first, end,
  );

  // Back to front, so neither run is overwritten before it is read.
  let a = first - 1;
  let b = incoming.length - 1;
  let w = end - 1;
  while (b >= 0) {
    if (a >= 0 && key[a] > dist[incoming[b]]) {
      idx[w] = idx[a];
      a--;
    } else {
      idx[w] = incoming[b];
      b--;
    }
    w--;
  }
  for (let i = w + 1; i < end; i++) key[i] = dist[idx[i]];
}

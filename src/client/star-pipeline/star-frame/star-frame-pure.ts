// The Sol-distance proximity index's in-place merge.
// See ./README.md § Absorbing a chunk.

/** `key` holds `Infinity` past `end` on entry and on exit — ./README.md
 *  § Absorbing a chunk. */
export function mergeSortedByDistance(
  dist: Float32Array,
  idx: Uint32Array,
  key: Float32Array,
  first: number,
  end: number,
): void {
  if (end <= first) return;
  const incoming = new Uint32Array(end - first);
  for (let i = first; i < end; i++) incoming[i - first] = i;
  incoming.sort((a, b) => dist[a] - dist[b]);

  // Back to front, so neither run is overwritten before it is read.
  let a = first - 1;
  let b = incoming.length - 1;
  let w = end - 1;
  while (b >= 0) {
    if (a >= 0 && dist[idx[a]] > dist[incoming[b]]) {
      idx[w] = idx[a];
      a--;
    } else {
      idx[w] = incoming[b];
      b--;
    }
    w--;
  }
  for (let i = 0; i < end; i++) key[i] = dist[idx[i]];
}

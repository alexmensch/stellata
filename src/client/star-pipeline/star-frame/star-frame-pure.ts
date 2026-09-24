// The Sol-distance proximity index's in-place merge.
// See ./README.md § Absorbing a chunk.

const RADIX_BITS = 11;
const RADIX = 1 << RADIX_BITS;
const RADIX_MASK = RADIX - 1;

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
  const incoming = sortIndicesByDistance(dist, first, end);

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

/** Indices `first..end−1` ordered by ascending `dist`, ties by index.
 *  Only valid for non-negative distances (`+Infinity` included): their
 *  IEEE-754 bit patterns order exactly as unsigned integers do, which a
 *  negative value's would not. ./README.md § Absorbing a chunk. */
export function sortIndicesByDistance(
  dist: Float32Array,
  first: number,
  end: number,
): Uint32Array {
  const n = end - first;
  const bits = new Uint32Array(dist.buffer, dist.byteOffset, dist.length);
  let src = new Uint32Array(n);
  let dst = new Uint32Array(n);
  for (let i = 0; i < n; i++) src[i] = first + i;
  const offsets = new Uint32Array(RADIX);
  for (let shift = 0; shift < 32; shift += RADIX_BITS) {
    offsets.fill(0);
    for (let i = first; i < end; i++) offsets[(bits[i] >>> shift) & RADIX_MASK]++;
    let sum = 0;
    for (let d = 0; d < RADIX; d++) {
      const c = offsets[d];
      offsets[d] = sum;
      sum += c;
    }
    for (let i = 0; i < n; i++) {
      const s = src[i];
      dst[offsets[(bits[s] >>> shift) & RADIX_MASK]++] = s;
    }
    [src, dst] = [dst, src];
  }
  return src;
}

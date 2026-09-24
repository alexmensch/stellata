// Stable index sort by key words; contract in ./README.md.

const DIGIT_BITS = 12;
const DIGIT_COUNT = 1 << DIGIT_BITS;
const DIGIT_MASK = DIGIT_COUNT - 1;

export function sortIndicesByKeyWords(
  words: readonly Uint32Array[],
  first: number,
  end: number,
): Uint32Array {
  const n = Math.max(0, end - first);
  let src = new Uint32Array(n);
  let dst = new Uint32Array(n);
  for (let i = 0; i < n; i++) src[i] = first + i;
  const offsets = new Uint32Array(DIGIT_COUNT);
  for (let k = 0; k < words.length; k++) {
    const word = words[k];
    for (let shift = 0; shift < 32; shift += DIGIT_BITS) {
      offsets.fill(0);
      for (let i = first; i < end; i++) offsets[(word[i] >>> shift) & DIGIT_MASK]++;
      if (offsets[(word[first] >>> shift) & DIGIT_MASK] === n) continue;
      let sum = 0;
      for (let d = 0; d < DIGIT_COUNT; d++) {
        const c = offsets[d];
        offsets[d] = sum;
        sum += c;
      }
      for (let i = 0; i < n; i++) {
        const s = src[i];
        dst[offsets[(word[s] >>> shift) & DIGIT_MASK]++] = s;
      }
      [src, dst] = [dst, src];
    }
  }
  return src;
}

// Bit-level comparison of two per-star A_V arrays, and its one-line
// console summary. README.md § Reading A_V back on the CPU.

export interface AvParityReport {
  compared: number;
  /** Stars whose float32 bit patterns differ. */
  mismatched: number;
  maxAbsDiff: number;
  /** The first star whose bits differ, or null when every one matched. */
  first: { idx: number; computed: number; reference: number } | null;
}

function bitsOf(a: Float32Array): Uint32Array {
  return new Uint32Array(a.buffer, a.byteOffset, a.length);
}

/** Compare star i of `computed` against texel i of `reference`, whose
 *  texels may carry more than one component (`referenceStride`). Bits,
 *  not values: two NaNs with different payloads count as a mismatch, and
 *  -0 against +0 does too — the check is that both paths ran the SAME
 *  arithmetic, not that they agree to a tolerance. */
export function compareAvBuffers(
  computed: Float32Array,
  reference: Float32Array,
  count: number,
  referenceStride = 1,
): AvParityReport {
  const a = bitsOf(computed);
  const b = bitsOf(reference);
  let mismatched = 0;
  let maxAbsDiff = 0;
  let first: AvParityReport['first'] = null;
  for (let i = 0; i < count; i++) {
    const j = i * referenceStride;
    if (a[i] === b[j]) continue;
    mismatched++;
    const diff = Math.abs(computed[i] - reference[j]);
    if (diff > maxAbsDiff || Number.isNaN(diff)) maxAbsDiff = diff;
    first ??= { idx: i, computed: computed[i], reference: reference[j] };
  }
  return { compared: count, mismatched, maxAbsDiff, first };
}

export function formatAvParity(r: AvParityReport): string {
  if (r.mismatched === 0) return `A_V parity: ${r.compared} stars, bit-identical`;
  const f = r.first!;
  return `A_V parity: ${r.mismatched} of ${r.compared} stars differ, max |Δ| ${r.maxAbsDiff}`
    + ` (first: star ${f.idx} compute ${f.computed} vs reference ${f.reference})`;
}

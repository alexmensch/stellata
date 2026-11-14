// Python's float arithmetic where it differs from JavaScript's; multiples.tsv's bytes rest on it. See README.md#files-in-this-area.

/** `sum()` over floats as Python 3.12+ computes it: Neumaier-compensated,
 *  the compensation added once at the end. A plain left fold differs in the
 *  last bits. */
export function pySum(values: Iterable<number>): number {
  let sum = 0.0;
  let c = 0.0;
  for (const x of values) {
    const t = sum + x;
    c += Math.abs(sum) >= Math.abs(x) ? (sum - t) + x : (x - t) + sum;
    sum = t;
  }
  return c !== 0 && Number.isFinite(c) ? sum + c : sum;
}

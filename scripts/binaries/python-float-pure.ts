// Python's float arithmetic where it differs from JavaScript's: the binaries stages' outputs must match the Python's byte for byte until the switch.

/** `x mod m` with the sign of `m`, as Python's `%` computes it — including
 *  its rounding up to `m` for a tiny negative `x`, which `((x % m) + m) % m`
 *  would wrap to 0. */
export function pyMod(x: number, m: number): number {
  const r = x % m;
  if (r === 0) return 0;
  return (r < 0) !== (m < 0) ? r + m : r;
}

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

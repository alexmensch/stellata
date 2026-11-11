// Python's float arithmetic where it differs from JavaScript's: the binaries stages' outputs must match the Python's byte for byte until the switch.

/** `x mod m` with the sign of `m`, as Python's `%` computes it — including
 *  its rounding up to `m` for a tiny negative `x`, which `((x % m) + m) % m`
 *  would wrap to 0. */
export function pyMod(x: number, m: number): number {
  const r = x % m;
  if (r === 0) return 0;
  return (r < 0) !== (m < 0) ? r + m : r;
}

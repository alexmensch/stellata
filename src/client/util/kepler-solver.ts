// Newton-Raphson solver for Kepler's equation `M = E − e·sin(E)`.
// Shared between Sol's planet ephemeris (`solar-system/ephemeris.ts`,
// e ≲ 0.25) and binary-star orbits (`binaries/binary-orbit-pure.ts`,
// e up to ~0.95). The defaults converge in ~3 iterations for planets
// and ~15 for the most eccentric binaries.

export function wrapAngle(a: number): number {
  const twoPi = 2 * Math.PI;
  let r = a - Math.floor(a / twoPi) * twoPi;
  if (r > Math.PI) r -= twoPi;
  return r;
}

export function solveKepler(
  M: number,
  e: number,
  tol = 1e-12,
  maxIter = 50,
): number {
  const Mw = wrapAngle(M);
  let E = Mw + e * Math.sin(Mw);
  for (let i = 0; i < maxIter; i++) {
    const dE = (E - e * Math.sin(E) - Mw) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < tol) break;
  }
  return E;
}

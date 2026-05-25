// Newton solver for Kepler's equation M = E − e·sin(E). Shared between
// planet ephemerides and binary orbits.

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

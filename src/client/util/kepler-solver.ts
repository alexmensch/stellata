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

// Cartesian position of a Keplerian orbit in its reference frame, given
// the classical elements and mean anomaly `M`. `out` is the in-plane
// ellipse (periapsis on +x') rotated by Rz(Ω)·Rx(I)·Rz(ω): +z along the
// reference-plane normal, +x toward the reference frame's node. Distance
// units follow `a`. Shared by the planet ephemeris (ecliptic frame) and
// the moon resolver (each moon's reference plane).
export function orbitalStateToCartesian(
  a: number,
  e: number,
  incRad: number,
  nodeRad: number,
  argPeriRad: number,
  M: number,
  out: { x: number; y: number; z: number },
): void {
  const E = solveKepler(M, e);
  const xP = a * (Math.cos(E) - e);
  const yP = a * Math.sqrt(1 - e * e) * Math.sin(E);

  const cosO = Math.cos(argPeriRad), sinO = Math.sin(argPeriRad);
  const cosN = Math.cos(nodeRad), sinN = Math.sin(nodeRad);
  const cosI = Math.cos(incRad), sinI = Math.sin(incRad);

  out.x =
    (cosO * cosN - sinO * sinN * cosI) * xP +
    (-sinO * cosN - cosO * sinN * cosI) * yP;
  out.y =
    (cosO * sinN + sinO * cosN * cosI) * xP +
    (-sinO * sinN + cosO * cosN * cosI) * yP;
  out.z =
    (sinO * sinI) * xP +
    (cosO * sinI) * yP;
}

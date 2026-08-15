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

/** Classical elements of the osculating orbit through a state vector —
 *  the inverse of `orbitalStateToCartesian`. `mu` is the two-body
 *  gravitational parameter in the same length unit as `r`, per (time unit
 *  of `v`)². Returned angles are radians; `i` comes back in [0, π] with
 *  the node measured in the reference plane. */
export function cartesianToOrbitalElements(
  r: { x: number; y: number; z: number },
  v: { x: number; y: number; z: number },
  mu: number,
): {
  a: number; e: number; incRad: number; nodeRad: number; argPeriRad: number;
  eccAnomalyRad: number;
} {
  const rMag = Math.hypot(r.x, r.y, r.z);
  const v2 = v.x * v.x + v.y * v.y + v.z * v.z;

  const hx = r.y * v.z - r.z * v.y;
  const hy = r.z * v.x - r.x * v.z;
  const hz = r.x * v.y - r.y * v.x;
  const hMag = Math.hypot(hx, hy, hz);

  const a = 1 / (2 / rMag - v2 / mu);
  const incRad = Math.acos(Math.min(1, Math.max(-1, hz / hMag)));
  const nodeRad = Math.atan2(hx, -hy);

  const rDotV = r.x * v.x + r.y * v.y + r.z * v.z;
  const c = v2 / mu - 1 / rMag;
  const ex = c * r.x - (rDotV / mu) * v.x;
  const ey = c * r.y - (rDotV / mu) * v.y;
  const ez = c * r.z - (rDotV / mu) * v.z;
  const e = Math.hypot(ex, ey, ez);

  const cosN = Math.cos(nodeRad), sinN = Math.sin(nodeRad);
  const cosI = Math.cos(incRad), sinI = Math.sin(incRad);
  // Eccentricity vector resolved on the in-plane basis (node direction,
  // and the in-plane normal to it) gives ω directly.
  const along = ex * cosN + ey * sinN;
  const across = (-ex * sinN + ey * cosN) * cosI + ez * sinI;
  // r = a(1 − e·cos E) and r·v = e·√(μa)·sin E together fix E without a
  // second solve. Both arguments carry the SAME factor of e — atan2 is
  // invariant under a shared positive scale and nothing else.
  const eccAnomalyRad = Math.atan2(rDotV / Math.sqrt(mu * a), 1 - rMag / a);
  return {
    a, e, incRad, nodeRad, argPeriRad: Math.atan2(across, along), eccAnomalyRad,
  };
}

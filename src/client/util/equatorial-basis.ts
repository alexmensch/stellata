// ICRS equatorial tangent basis — the radial + east/north unit vectors that
// proper-motion propagation, space-motion velocity, and sky-offset
// projection all resolve their components along.

export interface UnitVector {
  x: number;
  y: number;
  z: number;
}

/** Radial unit vector `u` plus the local east/north tangent unit vectors:
 *  east = ∂u/∂α / cos δ, north = ∂u/∂δ — the directions μ_α* and μ_δ act
 *  along. Stable through the poles: east never divides by cos δ. */
export interface TangentBasis {
  u: UnitVector;
  east: UnitVector;
  north: UnitVector;
}

const DEG_TO_RAD = Math.PI / 180;

export function equatorialTangentBasisRad(raRad: number, decRad: number): TangentBasis {
  const sinRa = Math.sin(raRad);
  const cosRa = Math.cos(raRad);
  const sinDec = Math.sin(decRad);
  const cosDec = Math.cos(decRad);
  return {
    u: { x: cosDec * cosRa, y: cosDec * sinRa, z: sinDec },
    east: { x: -sinRa, y: cosRa, z: 0 },
    north: { x: -sinDec * cosRa, y: -sinDec * sinRa, z: cosDec },
  };
}

export function equatorialTangentBasis(raDeg: number, decDeg: number): TangentBasis {
  return equatorialTangentBasisRad(raDeg * DEG_TO_RAD, decDeg * DEG_TO_RAD);
}

/** The basis at the ICRS direction of an equatorial Cartesian position,
 *  plus that position's distance from the origin. `null` at the origin,
 *  where no direction is defined. */
export function equatorialTangentBasisAt(
  x: number,
  y: number,
  z: number,
): { basis: TangentBasis; rPc: number } | null {
  const rPc = Math.hypot(x, y, z);
  if (!(rPc > 0)) return null;
  return {
    basis: equatorialTangentBasisRad(Math.atan2(y, x), Math.asin(z / rPc)),
    rPc,
  };
}

/** ICRS (ra, dec) in degrees → unit vector in the equatorial Cartesian
 *  basis catalog.bin uses (x toward RA 0h, z toward the north celestial
 *  pole). Multiplying by a distance in pc yields a record's xyz. */
export function unitVectorFromRaDec(raDeg: number, decDeg: number): UnitVector {
  return equatorialTangentBasis(raDeg, decDeg).u;
}

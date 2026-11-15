// ICRS equatorial tangent basis — the radial + east/north unit vectors that
// proper-motion propagation, space-motion velocity, and sky-offset
// projection all resolve their components along.

import { angleBetweenRad, pyMod } from './angles';
import { ARCSEC_TO_RAD, DEG_TO_RAD, MAS_TO_RAD, RAD_TO_DEG } from './astronomy-constants';

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

export interface SkyPosition {
  raDeg: number;
  decDeg: number;
}

/** Proper motion in mas/yr, μ_α* already cos δ-applied. */
export interface ProperMotion {
  pmRaMasyr: number | null;
  pmDecMasyr: number | null;
}

function hasProperMotion(pm: ProperMotion): pm is { pmRaMasyr: number; pmDecMasyr: number } {
  return pm.pmRaMasyr !== null && pm.pmDecMasyr !== null;
}

/** An east / north offset on the tangent plane, in arcsec. */
export interface TangentOffset {
  eastArcsec: number;
  northArcsec: number;
}

export interface PolarOffset {
  readonly sepArcsec: number;
  readonly paDeg: number;
}

/** A separation and position angle (east of north) as a tangent-plane offset. */
export function polarToTangent(sepArcsec: number, paDeg: number): TangentOffset {
  const pa = paDeg * DEG_TO_RAD;
  return { eastArcsec: sepArcsec * Math.sin(pa), northArcsec: sepArcsec * Math.cos(pa) };
}

/** The inverse of `polarToTangent`, the angle through `pyMod`: a tiny negative
 *  reads 360, not 0. */
export function tangentToPolar({ eastArcsec, northArcsec }: TangentOffset): PolarOffset {
  return {
    sepArcsec: Math.hypot(eastArcsec, northArcsec),
    paDeg: pyMod(Math.atan2(eastArcsec, northArcsec) * RAD_TO_DEG, 360),
  };
}

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

export function angularSeparationArcsec(a: UnitVector, b: UnitVector): number {
  return angleBetweenRad(a.x, a.y, a.z, b.x, b.y, b.z) / ARCSEC_TO_RAD;
}

export function offsetDirection(pos: SkyPosition, eastRad: number, northRad: number): UnitVector {
  const { u, east, north } = equatorialTangentBasis(pos.raDeg, pos.decDeg);
  const x = u.x + eastRad * east.x + northRad * north.x;
  const y = u.y + eastRad * east.y + northRad * north.y;
  const z = u.z + eastRad * east.z + northRad * north.z;
  const norm = Math.hypot(x, y, z);
  return { x: x / norm, y: y / norm, z: z / norm };
}

/** Sky direction at `toEpoch` of a source measured at `fromEpoch`, with no
 *  radial velocity term. Do NOT divide μ_α* by cos δ before calling. Either
 *  PM component missing → the measured direction, unmoved. */
export function directionAtEpoch(
  pos: SkyPosition, pm: ProperMotion, fromEpoch: number, toEpoch: number,
): UnitVector {
  if (!hasProperMotion(pm)) return unitVectorFromRaDec(pos.raDeg, pos.decDeg);
  return offsetDirection(
    pos,
    pm.pmRaMasyr * MAS_TO_RAD * (toEpoch - fromEpoch),
    pm.pmDecMasyr * MAS_TO_RAD * (toEpoch - fromEpoch),
  );
}

/** `directionAtEpoch` as (ra, dec); a position with no motion comes back
 *  exactly as given, not through the round trip. */
export function skyPositionAtEpoch(
  pos: SkyPosition, pm: ProperMotion, fromEpoch: number, toEpoch: number,
): SkyPosition {
  if (!hasProperMotion(pm)) return pos;
  return raDecFromUnitVector(directionAtEpoch(pos, pm, fromEpoch, toEpoch));
}

/** The inverse of `unitVectorFromRaDec`, with ra wrapped to [0, 360). */
export function raDecFromUnitVector(v: UnitVector): SkyPosition {
  const ra = pyMod(Math.atan2(v.y, v.x) * RAD_TO_DEG, 360);
  return {
    raDeg: ra === 360 ? 0 : ra,
    decDeg: Math.asin(Math.max(-1, Math.min(1, v.z))) * RAD_TO_DEG,
  };
}

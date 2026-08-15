// The fixed J2000 ecliptic ↔ ICRS equatorial rotation about the
// obliquity. See README.md § ecliptic-frame.ts.

import { J2000_OBLIQUITY_RAD } from './astronomy-constants';

const COS_OBLIQUITY = Math.cos(J2000_OBLIQUITY_RAD);
const SIN_OBLIQUITY = Math.sin(J2000_OBLIQUITY_RAD);

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** ICRS equatorial → J2000 ecliptic, `Rx(+ε)`. `out` may alias `v`. */
export function icrsToEcliptic(v: Readonly<Vec3>, out: Vec3): void {
  const { y, z } = v;
  out.x = v.x;
  out.y = COS_OBLIQUITY * y + SIN_OBLIQUITY * z;
  out.z = -SIN_OBLIQUITY * y + COS_OBLIQUITY * z;
}

/** J2000 ecliptic → ICRS equatorial, `Rx(−ε)`. `out` may alias `v`. */
export function eclipticToIcrs(v: Readonly<Vec3>, out: Vec3): void {
  const { y, z } = v;
  out.x = v.x;
  out.y = COS_OBLIQUITY * y - SIN_OBLIQUITY * z;
  out.z = SIN_OBLIQUITY * y + COS_OBLIQUITY * z;
}

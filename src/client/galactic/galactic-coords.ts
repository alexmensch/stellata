import * as THREE from 'three';

// J2000 ICRS coordinates of the galactic-frame axes:
//  - Galactic Centre (l=0, b=0): RA=266.4051°, Dec=−28.93617°
// - North Galactic Pole (b=+90°): RA=192.85948°, Dec=27.12825°
// Values from the IAU/Hipparcos definition of the J2000 galactic frame.
const ALPHA_GC = (266.4051 * Math.PI) / 180;
const DELTA_GC = (-28.93617 * Math.PI) / 180;
const ALPHA_NGP = (192.85948 * Math.PI) / 180;
const DELTA_NGP = (27.12825 * Math.PI) / 180;

// Distance from Sol to the galactic centre. R₀ = 8.122 kpc per GRAVITY 2018,
// adopted here so the Milky Way analytic background can reuse this
// constant directly without a second source of truth.
export const R0_PC = 8122.0;

const gcDir = new THREE.Vector3(
  Math.cos(DELTA_GC) * Math.cos(ALPHA_GC),
  Math.cos(DELTA_GC) * Math.sin(ALPHA_GC),
  Math.sin(DELTA_GC),
).normalize();

const ngpDir = new THREE.Vector3(
  Math.cos(DELTA_NGP) * Math.cos(ALPHA_NGP),
  Math.cos(DELTA_NGP) * Math.sin(ALPHA_NGP),
  Math.sin(DELTA_NGP),
).normalize();

// Build a strictly-orthonormal galactic-frame basis in ICRS:
//   +X = toward galactic centre (l=0, b=0)
//   +Z = toward NGP (b=+90)
//   +Y = +Z × +X  (l=90, b=0; standard right-handed convention)
// gcDir and ngpDir are not exactly perpendicular at full precision, so Z is
// re-derived from (X × Y) to land exactly orthogonal to both. The result
// is parallel to — but at single-arcsec scale not exactly equal to — the
// raw `ngpDir`. Don't compare galZ against ngpDir for equality; treat
// galZ as the canonical NGP direction within the orthonormal basis.
const galY = new THREE.Vector3().crossVectors(ngpDir, gcDir).normalize();
const galZ = new THREE.Vector3().crossVectors(gcDir, galY).normalize();

/**
 * Rotation only — the origin is unchanged, and translating to Sol-centric
 * absolute coordinates is the caller's job (`GALACTIC_CENTRE_PC`).
 */
export const GAL_TO_ICRS: THREE.Matrix4 =
  new THREE.Matrix4().makeBasis(gcDir, galY, galZ);

/**
 * The inverse of `GAL_TO_ICRS`, as a Matrix3. Galactic-frame components are
 * x toward GC, z toward NGP.
 */
export const ICRS_TO_GAL_M3: THREE.Matrix3 =
  new THREE.Matrix3().setFromMatrix4(GAL_TO_ICRS).transpose();

/**
 * Parsecs. The translation offset that pairs with `GAL_TO_ICRS` when placing
 * galactic-frame geometry into the world.
 */
export const GALACTIC_CENTRE_PC: THREE.Vector3 =
  gcDir.clone().multiplyScalar(R0_PC);

/**
 * Normal to the galactic plane — `galZ` re-orthogonalised against the GC
 * direction, never the raw NGP direction.
 */
export const GALACTIC_NORTH_POLE_ICRS: THREE.Vector3 = galZ.clone();

/**
 * `l`, `b` in **radians**.
 */
export function galacticDirToIcrs(
  lRad: number,
  bRad: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const cosB = Math.cos(bRad);
  return out
    .set(cosB * Math.cos(lRad), cosB * Math.sin(lRad), Math.sin(bRad))
    .applyMatrix4(GAL_TO_ICRS);
}

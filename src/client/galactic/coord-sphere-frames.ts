// The two coordinate-sphere frames: galactic l/b and equatorial RA/Dec.
// See galactic/README.md § Coordinate spheres.

import type * as THREE from 'three';
import { equatorialTangentBasisRad } from '../util/equatorial-basis';
import type { CoordSphereSpec } from './coord-sphere';
import { galacticDirToIcrs } from './galactic-coords';

/**
 * ICRS (α, δ) in radians → the ICRS unit direction, written into `out`.
 *
 * The identity frame: catalog.bin's Cartesian basis already has x toward
 * α = 0h and z toward the north celestial pole, so no rotation composes here —
 * unlike `galacticDirToIcrs`. Routed through the shared tangent basis rather
 * than restating cos δ·cos α, which is the drift `../util/README.md` warns of.
 */
export function equatorialDirToIcrs(
  raRad: number,
  decRad: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const { u } = equatorialTangentBasisRad(raRad, decRad);
  return out.set(u.x, u.y, u.z);
}

/** Whole-degree label wrapped to [0, 360) — galactic longitude. */
export function fmtLonDeg(deg: number): string {
  return `${((Math.round(deg) % 360) + 360) % 360}°`;
}

/** Whole-degree signed label — galactic latitude. */
export function fmtLatDeg(deg: number): string {
  return `${Math.round(deg)}°`;
}

/** Right ascension in whole hours. The 15°-spaced meridians below are exactly
 *  the hour circles, so this never rounds away a fraction. */
export function fmtRaHours(deg: number): string {
  return `${(((Math.round(deg / 15) % 24) + 24) % 24)}h`;
}

/** Declination in signed whole degrees, `+` written explicitly so a dec label
 *  never reads as a bare longitude. */
export function fmtDecDeg(deg: number): string {
  const d = Math.round(deg);
  return `${d > 0 ? '+' : ''}${d}°`;
}

export const GALACTIC_SPHERE_SPEC: CoordSphereSpec = {
  dirToIcrs: galacticDirToIcrs,
  meridianCount: 36,   // every 10° of l
  labelGroupId: 'gal-grid-labels',
  lonLabel: fmtLonDeg,
  latLabel: fmtLatDeg,
};

// 24 meridians, not the galactic sphere's 36: an equatorial grid's meridians
// are the hour circles, so 15° spacing is the conventional one and is what
// makes every label a whole hour.
export const EQUATORIAL_SPHERE_SPEC: CoordSphereSpec = {
  dirToIcrs: equatorialDirToIcrs,
  meridianCount: 24,
  labelGroupId: 'eq-grid-labels',
  lonLabel: fmtRaHours,
  latLabel: fmtDecDeg,
};

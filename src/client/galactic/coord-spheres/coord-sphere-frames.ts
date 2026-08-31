// The two coordinate-sphere frames — galactic l/b and equatorial RA/Dec — and
// the reachability + `S`-cycle rules that read off them.
// See galactic/README.md § Coordinate spheres.

import * as THREE from 'three';
import { equatorialTangentBasisRad } from '../../util/equatorial-basis';
import type {
  CoordSphereFrame,
  CoordSphereSpec,
  DrawnCoordSphereFrame,
} from './coord-sphere';
import { galacticDirToIcrs } from '../galactic-coords';

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

/** Earth's axial tilt (IAU 2006, J2000): the angle between the equatorial and
 *  ecliptic planes, and the whole of the rotation between the two frames. */
export const OBLIQUITY_RAD = (23.4392911 * Math.PI) / 180;
const COS_OBLIQUITY = Math.cos(OBLIQUITY_RAD);
const SIN_OBLIQUITY = Math.sin(OBLIQUITY_RAD);

/**
 * Ecliptic (λ, β) in radians → the ICRS unit direction, written into `out`.
 *
 * The two frames share the vernal equinox as their zero longitude and differ
 * only by a rotation about it, so this is the equatorial mapping turned about
 * x by the obliquity: the ecliptic pole lands at α 18h, δ +66.56°.
 */
export function eclipticDirToIcrs(
  lonRad: number,
  latRad: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const { u } = equatorialTangentBasisRad(lonRad, latRad);
  return out.set(
    u.x,
    u.y * COS_OBLIQUITY - u.z * SIN_OBLIQUITY,
    u.y * SIN_OBLIQUITY + u.z * COS_OBLIQUITY,
  );
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

// Ecliptic longitude is measured in degrees, not hours, so this takes the
// galactic sphere's 10° parametrisation rather than the equatorial one's
// hour circles.
export const ECLIPTIC_SPHERE_SPEC: CoordSphereSpec = {
  dirToIcrs: eclipticDirToIcrs,
  meridianCount: 36,
  labelGroupId: 'ecl-grid-labels',
  lonLabel: fmtLonDeg,
  latLabel: fmtLatDeg,
};

export const COORD_SPHERE_SPECS: Record<DrawnCoordSphereFrame, CoordSphereSpec> = {
  galactic: GALACTIC_SPHERE_SPEC,
  ecliptic: ECLIPTIC_SPHERE_SPEC,
  equatorial: EQUATORIAL_SPHERE_SPEC,
};

/** Every frame that draws something, in panel order — widest reference plane
 *  first. Each consumer — the scene layer, the resize hook, the label pools —
 *  iterates this rather than naming the spheres, so a further frame is a table
 *  entry. */
export const DRAWN_COORD_SPHERE_FRAMES: readonly DrawnCoordSphereFrame[] =
  ['galactic', 'ecliptic', 'equatorial'];

/** Cycle order for the `S` key and the panel's stop control. */
export const COORD_SPHERE_FRAMES: readonly CoordSphereFrame[] =
  ['none', ...DRAWN_COORD_SPHERE_FRAMES];

function northPoleOf(spec: CoordSphereSpec): THREE.Vector3 {
  return spec.dirToIcrs(0, Math.PI / 2, new THREE.Vector3()).normalize();
}

const COORD_SPHERE_NORTH_POLES: Record<DrawnCoordSphereFrame, THREE.Vector3> = {
  galactic: northPoleOf(GALACTIC_SPHERE_SPEC),
  ecliptic: northPoleOf(ECLIPTIC_SPHERE_SPEC),
  equatorial: northPoleOf(EQUATORIAL_SPHERE_SPEC),
};

/** A frame's own north, galactic when no sphere is up. Derived through the
 *  spec's own `dirToIcrs`, so what `L` levels to and what the grid draws are
 *  one value rather than two that agree. Precomputed per frame — the level
 *  path allocates nothing. Callers must NOT mutate the returned vector. */
export function coordSphereNorthPole(frame: CoordSphereFrame): THREE.Vector3 {
  return COORD_SPHERE_NORTH_POLES[frame === 'none' ? 'galactic' : frame];
}

/** The next frame in the observe-mode `S` cycle, skipping any sphere
 *  `available` rejects — pressing `S` must never land on a frame that
 *  describes nothing from the object you are standing on. `none` is always in
 *  the cycle, so this always terminates. */
export function nextCoordSphereFrame(
  cur: CoordSphereFrame,
  available: (frame: DrawnCoordSphereFrame) => boolean,
): CoordSphereFrame {
  const n = COORD_SPHERE_FRAMES.length;
  const from = COORD_SPHERE_FRAMES.indexOf(cur);
  for (let step = 1; step <= n; step++) {
    const next = COORD_SPHERE_FRAMES[(from + step) % n];
    if (next === 'none' || available(next)) return next;
  }
  return 'none';
}

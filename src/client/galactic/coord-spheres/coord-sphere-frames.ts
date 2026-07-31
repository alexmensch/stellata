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
import { solFrameFadeFactor, type SolFrameFadeWindow } from '../galactic-fade';
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

/** Where the RA/Dec sphere starts fading and where it is gone, as camera
 *  distance from Sol. Full strength across the solar system, gone before the
 *  first star — see galactic/README.md § The equatorial sphere is Sol-only for
 *  why an Earth-referenced frame needs one at all. */
export const EQUATORIAL_FADE_WINDOW_PC: SolFrameFadeWindow = { innerPc: 0.4, outerPc: 2.0 };

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
  fadeWindow: EQUATORIAL_FADE_WINDOW_PC,
};

export const COORD_SPHERE_SPECS: Record<DrawnCoordSphereFrame, CoordSphereSpec> = {
  galactic: GALACTIC_SPHERE_SPEC,
  equatorial: EQUATORIAL_SPHERE_SPEC,
};

/** Every frame that draws something, in panel order. Each consumer — the
 *  scene layer, the resize hook, the label pools — iterates this rather than
 *  naming the two spheres, so a third frame is a table entry. */
export const DRAWN_COORD_SPHERE_FRAMES: readonly DrawnCoordSphereFrame[] =
  ['galactic', 'equatorial'];

/** Cycle order for the `S` key and the panel's 3-stop control. */
export const COORD_SPHERE_FRAMES: readonly CoordSphereFrame[] =
  ['none', ...DRAWN_COORD_SPHERE_FRAMES];

function northPoleOf(spec: CoordSphereSpec): THREE.Vector3 {
  return spec.dirToIcrs(0, Math.PI / 2, new THREE.Vector3()).normalize();
}

const COORD_SPHERE_NORTH_POLES: Record<DrawnCoordSphereFrame, THREE.Vector3> = {
  galactic: northPoleOf(GALACTIC_SPHERE_SPEC),
  equatorial: northPoleOf(EQUATORIAL_SPHERE_SPEC),
};

/** The pole a roll gesture levels against — the displayed sphere's own north,
 *  galactic when no sphere is up. Derived through the spec's own `dirToIcrs`,
 *  so the alignment guide cannot disagree with the grid it sticks to.
 *  Callers must NOT mutate the returned vector. */
export function coordSphereNorthPole(frame: CoordSphereFrame): THREE.Vector3 {
  return COORD_SPHERE_NORTH_POLES[frame === 'none' ? 'galactic' : frame];
}

/** Stroke alpha `frame` draws at from this distance from Sol — 1 for a frame
 *  with no fade window. The SVG edge labels ride the same value, so text dims
 *  in step with the lines it annotates. */
export function coordSphereFadeAt(
  frame: DrawnCoordSphereFrame,
  distFromSolPc: number,
): number {
  const { fadeWindow } = COORD_SPHERE_SPECS[frame];
  return fadeWindow ? solFrameFadeFactor(distFromSolPc, fadeWindow) : 1;
}

/** Does `frame` draw anything at all from here? The single cut: the `S` cycle
 *  skips an unreachable stop, the panel disables it, and the scene layer
 *  deselects a sphere that crosses out. */
export function coordSphereReachableAt(
  frame: DrawnCoordSphereFrame,
  distFromSolPc: number,
): boolean {
  return coordSphereFadeAt(frame, distFromSolPc) > 0;
}

/** The next frame in the `S` cycle, skipping any sphere `reachable` rejects —
 *  pressing `S` must never leave an enabled-but-invisible sphere. `none` is
 *  always in the cycle, so this always terminates. */
export function nextCoordSphereFrame(
  cur: CoordSphereFrame,
  reachable: (frame: DrawnCoordSphereFrame) => boolean,
): CoordSphereFrame {
  const n = COORD_SPHERE_FRAMES.length;
  const from = COORD_SPHERE_FRAMES.indexOf(cur);
  for (let step = 1; step <= n; step++) {
    const next = COORD_SPHERE_FRAMES[(from + step) % n];
    if (next === 'none' || reachable(next)) return next;
  }
  return 'none';
}

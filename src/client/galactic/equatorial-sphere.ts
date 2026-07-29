// The equatorial (RA/Dec) coordinate sphere: shared sphere geometry in the
// equatorial frame plus the Sol-distance self-hide.
// See galactic/README.md § Coordinate spheres.

import type * as THREE from 'three';
import { CoordSphere } from './coord-sphere';
import { EQUATORIAL_SPHERE_SPEC } from './coord-sphere-frames';
import { solFrameFadeFactor, type SolFrameFadeWindow } from './galactic-fade';

/**
 * Where the RA/Dec sphere starts fading and where it is gone, as camera
 * distance from Sol in parsecs.
 *
 * Declination is measured from Earth's rotational axis and right ascension
 * from the vernal equinox, so unlike the galactic frame this one carries no
 * meaning away from the solar system — the fade is a relevance boundary, not a
 * precision one. The window is the fixed pair `stellata-sp4q` derived for its
 * boundary arcs; the boundary layer's own magnitude-keyed quantile table isn't
 * reused because its criterion (a star reading as misplaced relative to its
 * cell *wall*) has no analogue for a camera-tracked frame grid, which has no
 * walls. Both land in the same sub-parsec-to-a-few-parsecs band: the sphere is
 * available throughout the solar system and gone before the first star.
 */
export const EQUATORIAL_FADE_WINDOW_PC: SolFrameFadeWindow = { innerPc: 0.4, outerPc: 2.0 };

/** Stroke-opacity multiplier at this distance from Sol. Also what the SVG edge
 *  labels ride, so text dims in step with the lines it annotates rather than
 *  staying crisp over a nearly-faded grid. */
export function equatorialSphereFadeAt(distFromSolPc: number): number {
  return solFrameFadeFactor(distFromSolPc, EQUATORIAL_FADE_WINDOW_PC);
}

/** Is the sphere visible at all at this distance from Sol? Both affordances
 *  gate on this — the `S` cycle skips the equatorial stop and the panel
 *  disables it — and the shell deselects the sphere outright on the crossing,
 *  so nothing can leave it enabled-but-invisible. */
export function equatorialSphereReachableAt(distFromSolPc: number): boolean {
  return equatorialSphereFadeAt(distFromSolPc) > 0;
}

/**
 * Camera-tracked like the galactic sphere — it is still an observer-centred sky
 * sphere, and RA/Dec axes are fixed in absolute space, so the geometry stays
 * correctly aimed from anywhere. Distance from Sol drives opacity only; it is
 * deliberately NOT Sol-pinned the way the IAU boundary arcs are
 * (`../constellation-boundaries/README.md` § Chart-mode layer).
 */
export class EquatorialSphere {
  private readonly sphere = new CoordSphere(EQUATORIAL_SPHERE_SPEC);
  readonly group = this.sphere.group;

  update(cameraPosition: THREE.Vector3, distFromSolPc: number): void {
    const scale = equatorialSphereFadeAt(distFromSolPc);
    if (scale <= 0) {
      this.group.visible = false;
      return;
    }
    this.sphere.setOpacityScale(scale);
    this.sphere.update(cameraPosition);
    this.group.visible = true;
  }

  setResolution(w: number, h: number): void {
    this.sphere.setResolution(w, h);
  }

  setMonochrome(on: boolean): void {
    this.sphere.setMonochrome(on);
  }

  dispose(): void {
    this.sphere.dispose();
  }
}

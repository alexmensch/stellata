// Pure decision helpers for SolarSystemCluster: local-depth-pass
// activation + the orbit-ring bounding-sphere extent. Vitest-pinned.

import { AU_PC } from '../util/astronomy-constants';

/** Fraction past the outermost apoapsis the ring-extent bounding sphere
 *  reaches, so the slice bracket comfortably contains the drawn arcs. */
export const RING_EXTENT_MARGIN = 1.02;

/** A host's system is locally active when the camera is inside its body
 *  cull distance, or its orbit rings are drawing (rings outlive the body
 *  cull at far framings). Both distances are camera-relative pc. */
export function isHostLocallyActive(
  dHostPc: number,
  cullDistancePc: number,
  ringsUp: boolean,
): boolean {
  return dHostPc <= cullDistancePc || ringsUp;
}

interface RingExtentPlanet {
  parentName?: string;
  semiMajorAxisAu: number;
  eccentricity: number;
}

/** Bounding radius (pc) of the host-centred orbit-ring extent: the
 *  outermost planet apoapsis (moons excluded — they orbit a planet, not
 *  the host) times RING_EXTENT_MARGIN. 0 when the host has no host-
 *  orbiting planet. */
export function ringExtentRadiusPc(planets: readonly RingExtentPlanet[]): number {
  let maxApoapsisAu = 0;
  for (const planet of planets) {
    if (planet.parentName) continue;
    const apo = planet.semiMajorAxisAu * (1 + planet.eccentricity);
    if (apo > maxApoapsisAu) maxApoapsisAu = apo;
  }
  return maxApoapsisAu * AU_PC * RING_EXTENT_MARGIN;
}

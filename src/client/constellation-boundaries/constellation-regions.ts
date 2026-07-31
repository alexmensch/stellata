// The shipped region set, read two ways: positional membership for any
// object's position, and one chart label anchor per region.
// See README.md § Runtime membership.

import * as THREE from 'three';

import {
  decodeRegionGrid,
  type BoundaryArtifact,
} from '../../../scripts/catalog/boundaries/boundaries-artifact-pure';
import { SPHERE_RADIUS_PC } from '../galactic/coord-spheres/coord-sphere';
import { raDecFromUnitVector } from '../util/equatorial-basis';
import { constellationKey, createGridConstellationLookup } from './iau-geometry/iau-boundaries-pure';

export interface ConstellationTableEntry {
  code: string;
  name: string;
}

/** IAU-88 name for a position, from the artifact's region grid. */
export interface ConstellationNamer {
  /** Absolute (Sol-centred ICRS) position in parsecs → constellation name.
   *  Null only at the origin: Sol has no direction, so no constellation —
   *  the same hole byte 34 leaves. */
  nameAt(absolutePc: { x: number; y: number; z: number }): string | null;
}

/** Where a region's Latin name is written, and what it reads. */
export interface ConstellationLabelAnchor {
  /** Region code. The DOM pool key, so Serpens' two anchors stay distinct
   *  where their shared display name would collide. */
  code: string;
  /** IAU-88 name — both Serpens parts read "Serpens". */
  name: string;
  /** IAU-88 table index, for the member-star gate — Serpens' two anchors
   *  share one, because the constellation is one. */
  conIndex: number;
  /** Sol-frame ICRS position on the boundary sphere, parsecs. */
  position: THREE.Vector3;
}

export interface ConstellationRegions {
  /** Membership for any position the catalogue never classified — a planet at
   *  the current epoch, a galaxy, a cloud. */
  namer: ConstellationNamer;
  /** One per region, so Serpens carries two. */
  labelAnchors: ConstellationLabelAnchor[];
}

/**
 * Both readings of the artifact's region set, off one decode and one keyed
 * table — the grid the build emitted from the same decomposition that assigned
 * byte 34, so a star and the planet beside it are answered by one partition,
 * not two.
 *
 * Anchors are baked to absolute ICRS at `SPHERE_RADIUS_PC`, exactly as
 * `ConstellationBoundaryLayer` bakes the arcs, so a label rides the block it
 * names from any camera position instead of drifting off it.
 */
export function createConstellationRegions(
  artifact: BoundaryArtifact,
  constellations: readonly ConstellationTableEntry[],
): ConstellationRegions {
  // Keyed the way the region codes resolve — lowercase 3-letter code, which is
  // what `constellationKey` produces.
  const indices = new Map(constellations.map((c, i) => [c.code.toLowerCase(), i]));
  const lookup = createGridConstellationLookup(decodeRegionGrid(artifact.regions));

  const labelAnchors: ConstellationLabelAnchor[] = [];
  for (const label of artifact.labels) {
    const conIndex = indices.get(constellationKey(label.c));
    if (conIndex === undefined) continue;
    labelAnchors.push({
      code: label.c,
      name: constellations[conIndex].name,
      conIndex,
      position: new THREE.Vector3(label.d[0], label.d[1], label.d[2])
        .multiplyScalar(SPHERE_RADIUS_PC),
    });
  }

  return {
    namer: {
      nameAt(absolutePc) {
        const { x, y, z } = absolutePc;
        const length = Math.hypot(x, y, z);
        if (length === 0) return null;
        const key = lookup.keyAt(raDecFromUnitVector({
          x: x / length, y: y / length, z: z / length,
        }));
        const idx = indices.get(key);
        return idx === undefined ? null : constellations[idx].name;
      },
    },
    labelAnchors,
  };
}

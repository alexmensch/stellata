// The star quad geometries: one per survivor tier, corner + index only,
// drawn indirect off the compaction kernel's argument slot for that tier.

import * as THREE from 'three';
import type { IndirectStorageBufferAttribute } from 'three/webgpu';
import { STAR_QUAD_CORNERS, STAR_QUAD_INDEX } from '../../star-pipeline/star-quad';
import {
  STAR_TIER_DISC, STAR_TIER_GLOW, tierArgsOffsetBytes, type StarTier,
} from './compaction/compaction-pure';

export const STAR_QUAD_INDEX_COUNT = STAR_QUAD_INDEX.length;

export interface StarGeometries {
  glow: THREE.InstancedBufferGeometry;
  /** Shared by the disc draw and the core mask — one list, one count. */
  disc: THREE.InstancedBufferGeometry;
}

/** `instanceCount` is nominal: three skips a geometry whose count is 0
 *  before reaching the indirect draw, and the args slot decides the rest. */
export function buildStarGeometries(
  count: number,
  boundingSphereRadiusPc: number,
  args: IndirectStorageBufferAttribute,
): StarGeometries {
  const corner = new THREE.BufferAttribute(STAR_QUAD_CORNERS, 2);
  const index = new THREE.Uint16BufferAttribute(STAR_QUAD_INDEX, 1);
  const build = (tier: StarTier) => {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('aCorner', corner);
    geometry.setIndex(index);
    geometry.setIndirect(args, tierArgsOffsetBytes(tier));
    geometry.instanceCount = count;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), boundingSphereRadiusPc);
    return geometry;
  };
  return { glow: build(STAR_TIER_GLOW), disc: build(STAR_TIER_DISC) };
}

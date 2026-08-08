// Geometry helpers shared by kind modules' capability legs.
// See ./README.md.

import type * as THREE from 'three';
import type { KindContext } from './kind-module';

/** Live camera→object distance (pc) for an object held in absolute
 *  catalog coordinates — the focus card's `cameraDistancePc` leg for
 *  every kind whose centre is absolute (cloud, lg). Component-wise so
 *  the local-frame conversion costs no scratch vector. */
export function absCameraDistancePc(
  ctx: KindContext,
  centerAbs: Readonly<THREE.Vector3>,
): number {
  const w = ctx.getWorldOffset();
  const c = ctx.camera.position;
  return Math.hypot(
    centerAbs.x - w.x - c.x,
    centerAbs.y - w.y - c.y,
    centerAbs.z - w.z - c.z,
  );
}

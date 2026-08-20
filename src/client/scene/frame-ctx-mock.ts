// FrameCtx test fixture builder shared by the scene-layer suites.

import * as THREE from 'three';
import type { FrameCtx } from './scene-layer';

/** A camera parked at Sol on the model clock's zero, no warp — the
 *  neutral frame a layer's `update` sees. Override the field the test is
 *  actually about (`distFromSol` for a fade gate, `warpActive` for a
 *  warp gate). */
export function makeFrameCtx(
  camera: THREE.PerspectiveCamera,
  overrides: Partial<FrameCtx> = {},
): FrameCtx {
  return {
    camera,
    worldOffset: new THREE.Vector3(),
    distFromSol: 0,
    t: 0,
    warpActive: false,
    // 900 px viewport at a 1-radian FOV — a round default for budget math.
    pxPerRadian: 900,
    ...overrides,
  };
}

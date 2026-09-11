// FrameCtx / CadenceCtx test fixture builders shared by the scene-layer
// and per-layer cadence suites.

import * as THREE from 'three';
import { FrameFrustum } from './frame-frustum';
import type { CadenceCtx, FrameCtx } from './scene-layer';

/** The pinned acceptance plate scale: a 900 CSS-px-tall viewport at the
 *  default 50° vertical FOV, which is what
 *  `../render-gate/cadence/README.md` § Pinned vantages quotes every rate
 *  against.
 *  `angularToPx` is viewport height over FOV in radians. */
export const ACCEPTANCE_PX_PER_RADIAN = 900 / ((50 * Math.PI) / 180);

/** A camera parked at Sol on the model clock's zero, no warp, the
 *  acceptance plate scale and a frustum already refreshed from `camera`
 *  — the neutral frame a layer's `update` or `skip` sees. Override the
 *  field the test is actually about (`distFromSol` for a fade gate,
 *  `warpActive` for a warp gate). */
export function makeFrameCtx(
  camera: THREE.PerspectiveCamera,
  overrides: Partial<FrameCtx> = {},
): FrameCtx {
  const frustum = new FrameFrustum();
  frustum.refresh(camera);
  return {
    camera,
    worldOffset: new THREE.Vector3(),
    distFromSol: 0,
    t: 0,
    warpActive: false,
    pxPerRadian: ACCEPTANCE_PX_PER_RADIAN,
    frustum,
    ...overrides,
  };
}

/** A still camera on a one-second sim step, nothing riding — the neutral
 *  frame a layer's cadence report sees. Override `cameraVelPcPerSimS` for
 *  a ride, `simDtS` for a different step. */
export function makeCadenceCtx(
  camera: THREE.PerspectiveCamera,
  overrides: Partial<CadenceCtx> = {},
): CadenceCtx {
  return {
    camera,
    frameId: 1,
    pxPerRadian: ACCEPTANCE_PX_PER_RADIAN,
    simDtS: 1,
    cameraVelPcPerSimS: new THREE.Vector3(),
    ...overrides,
  };
}

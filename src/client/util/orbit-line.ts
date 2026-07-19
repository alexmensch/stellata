// Alpha-blended line-loop primitive shared by the orbital-geometry
// overlays (planet orbit rings, binary orbit paths).

import * as THREE from 'three';

// Vertices per ellipse. 256 keeps a large orbit (Sirius B, Neptune) smooth
// on close approach — 128 facets visibly along the long axis.
export const ORBIT_LINE_SEGMENTS = 256;
export const ORBIT_LINE_OPACITY = 0.5;

/** Screen pixels per radian of angular size, from the camera's vertical FOV
 *  and viewport height. Pair with `angularRadiusPx` for the on-screen size
 *  visibility gate shared by the orbit overlays. */
export function pixelsPerRadian(fovDeg: number, viewportHeightPx: number): number {
  return viewportHeightPx / ((fovDeg * Math.PI) / 180);
}

/** On-screen radius (px) of a feature of half-extent `sizePc` at range
 *  `distancePc`. */
export function angularRadiusPx(sizePc: number, distancePc: number, pxPerRad: number): number {
  return Math.atan(sizePc / Math.max(distancePc, 1e-30)) * pxPerRad;
}

export function makeOrbitLineMaterial(color: number): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: ORBIT_LINE_OPACITY,
    depthTest: true,
    depthWrite: false,
  });
}

export function makeOrbitLineLoop(
  points: Float32Array,
  material: THREE.LineBasicMaterial,
  renderOrder: number,
): THREE.LineLoop {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(points, 3));
  const loop = new THREE.LineLoop(geom, material);
  // A sub-AU loop with the camera potentially inside it culls unreliably;
  // let the GPU clip per-vertex.
  loop.frustumCulled = false;
  loop.renderOrder = renderOrder;
  return loop;
}

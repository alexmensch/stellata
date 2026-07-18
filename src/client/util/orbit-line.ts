// Alpha-blended line-loop primitive shared by the orbital-geometry
// overlays (planet orbit rings, binary orbit paths).

import * as THREE from 'three';

// 128 keeps even the tightest ellipse smooth at maximum zoom; a lower
// count facets visibly on close approach.
export const ORBIT_LINE_SEGMENTS = 128;
export const ORBIT_LINE_OPACITY = 0.5;

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

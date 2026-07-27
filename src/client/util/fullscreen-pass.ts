// Geometry for a shader pass that covers the whole target, paired with
// fullscreen-pass.vert.glsl.

import * as THREE from 'three';

/** Index is load-bearing, not an optimisation: with no `position`
 *  attribute (the shader reads `aPosition`), the renderer derives its
 *  draw count from `index.count` — un-indexed, the count resolves to 0
 *  and the pass silently draws nothing. */
export function fullscreenTriangleGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'aPosition',
    new THREE.BufferAttribute(new Float32Array([-1, -1, 3, -1, -1, 3]), 2),
  );
  geometry.setIndex([0, 1, 2]);
  return geometry;
}

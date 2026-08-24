import * as THREE from 'three';

// World-to-screen projection for SVG overlays. Returns null when the
// input projects at or behind the camera (camera.near = 1e-12 pc
// under logarithmicDepthBuffer, so the threshold acts as plain
// "view-z >= 0"). Pixel coordinates are CSS-pixel space (x right, y
// down) — every overlay uses this convention.
const scratch = /*@__PURE__*/ new THREE.Vector3();

// Every caller owns its output tuple and reuses it across calls, so the
// projector allocates nothing: it runs per POI / per label / per pick
// candidate, and the allocating wrapper this replaced was the dominant
// churn on those paths. A caller that needs to hold the result past the
// next projection has to copy it. Returns false (leaving `out` untouched)
// when the point is at or behind the near plane.
export function projectToScreenInto(
  p: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  w: number,
  h: number,
  out: [number, number],
): boolean {
  scratch.copy(p).applyMatrix4(camera.matrixWorldInverse);
  if (scratch.z >= -camera.near) return false;
  scratch.applyMatrix4(camera.projectionMatrix);
  out[0] = (scratch.x + 1) * 0.5 * w;
  out[1] = (1 - scratch.y) * 0.5 * h;
  return true;
}

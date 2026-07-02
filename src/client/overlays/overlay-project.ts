import * as THREE from 'three';

// World-to-screen projection for SVG overlays. Returns null when the
// input projects at or behind the camera (camera.near = 1e-10 pc
// under logarithmicDepthBuffer, so the threshold acts as plain
// "view-z >= 0"). Pixel coordinates are CSS-pixel space (x right, y
// down) — every overlay uses this convention.
const scratch = /*@__PURE__*/ new THREE.Vector3();

export function projectToScreen(
  p: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  w: number,
  h: number,
): [number, number] | null {
  const out: [number, number] = [0, 0];
  return projectToScreenInto(p, camera, w, h, out) ? out : null;
}

// Out-param variant for per-frame hot-path callers projecting many points
// a frame (disc mask, focus ring, constellation lines, HUD arrows) — reuse
// a single caller-owned tuple across calls instead of allocating a fresh
// one every projection. Returns false (leaving `out` untouched) when the
// point is at or behind the near plane.
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

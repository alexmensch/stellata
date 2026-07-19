// Alpha-blended line primitives (loop + segments) shared by the
// orbital-geometry overlays (planet orbit rings, binary orbit paths) and the
// constellation figure layer.

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

/** `localPass` strips the built-in log-depth chunks so fragments keep
 *  standard bracket depth — required for any line rendered in the
 *  local depth pass (src/client/local-depth/README.md). */
export function makeOrbitLineMaterial(
  color: number,
  opacity: number = ORBIT_LINE_OPACITY,
  localPass = false,
): THREE.LineBasicMaterial {
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: true,
    depthWrite: false,
  });
  if (localPass) {
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <logdepthbuf_pars_vertex>', '')
        .replace('#include <logdepthbuf_vertex>', '');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <logdepthbuf_pars_fragment>', '')
        .replace('#include <logdepthbuf_fragment>', '');
    };
    mat.customProgramCacheKey = () => 'orbit-line-local-depth';
  }
  return mat;
}

export function makeOrbitLineLoop(
  points: Float32Array,
  material: THREE.LineBasicMaterial,
  renderOrder: number,
): THREE.LineLoop {
  return configureLinePrimitive(
    new THREE.LineLoop(orbitLineGeometry(points), material), renderOrder);
}

export function makeOrbitLineSegments(
  points: Float32Array,
  material: THREE.LineBasicMaterial,
  renderOrder: number,
): THREE.LineSegments {
  return configureLinePrimitive(
    new THREE.LineSegments(orbitLineGeometry(points), material), renderOrder);
}

function orbitLineGeometry(points: Float32Array): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(points, 3));
  return geom;
}

// A loop or figure with the camera potentially inside it culls unreliably on
// a bounding-sphere test; let the GPU clip per-vertex.
function configureLinePrimitive<T extends THREE.Object3D>(line: T, renderOrder: number): T {
  line.frustumCulled = false;
  line.renderOrder = renderOrder;
  return line;
}

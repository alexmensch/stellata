// Alpha-blended line primitives (loop + segments) shared by the
// orbital-geometry overlays (planet orbit rings, binary orbit paths) and the
// constellation figure layer.

import * as THREE from 'three';

// Vertices per ellipse. The binding requirement is body-on-the-line at
// resolved-disc zoom under fast scrub: the polyline's max sagitta is
// ≈ a·(π/N)²/2, and the body sweeping vertex-to-vertex oscillates by
// it — a visible wobble against the disc when the scrub rate crosses
// many chords per second. Worst case is Pluto (a = 39.5 AU vs
// r = 1188 km): N = 8192 puts the sagitta at ~435 km ≈ 0.37 Pluto
// radii (4096 left 1740 km ≈ 1.5 radii, a perceptible high-scrub
// wobble). Cost is still small: ~30 line loops × 8192 verts, rebuilt
// only on focus change / sim-day drift.
export const ORBIT_LINE_SEGMENTS = 8192;
export const ORBIT_LINE_OPACITY = 0.5;

/** Screen pixels per radian of angular size, from the camera's vertical FOV
 *  and viewport height. Pair with `angularRadiusPx` for the on-screen size
 *  visibility gate shared by the orbit overlays. */
export function pixelsPerRadian(fovDeg: number, viewportHeightPx: number): number {
  return pixelsPerRadianFromFovRad((fovDeg * Math.PI) / 180, viewportHeightPx);
}

/** As `pixelsPerRadian`, for callers that already hold the vertical FOV in
 *  radians (e.g. the shared uFovYRad uniform). */
export function pixelsPerRadianFromFovRad(fovRad: number, viewportHeightPx: number): number {
  return viewportHeightPx / fovRad;
}

/** On-screen radius (px) of a feature of half-extent `sizePc` at range
 *  `distancePc`. */
export function angularRadiusPx(sizePc: number, distancePc: number, pxPerRad: number): number {
  return Math.atan(sizePc / Math.max(distancePc, 1e-30)) * pxPerRad;
}

/** On-screen angular radius (px) below which a thin circular/extended
 *  feature reads as sub-pixel clutter rather than legible structure. The
 *  shared floor behind both the orbit-ring visibility gate
 *  (`RING_VISIBILITY_THRESHOLD_PX`) and boundary-shell silhouette labels
 *  (`isShellLabelResolvable`) — one source so the two can't drift. */
export const FEATURE_LEGIBILITY_MIN_PX = 6;

/** Whether a feature of half-extent `sizePc` at range `distancePc` clears
 *  the legibility floor. The screen-size predicate a referent's label
 *  gates on so the label shows exactly while its geometry reads. */
export function isFeatureLegible(sizePc: number, distancePc: number, pxPerRad: number): boolean {
  return angularRadiusPx(sizePc, distancePc, pxPerRad) >= FEATURE_LEGIBILITY_MIN_PX;
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

/** Open polyline through `points` in order — the variant for a traversed
 *  path with two ends (a probe's launch→now trail) rather than a closed
 *  orbit. Callers that draw a growing prefix of a fixed-capacity buffer
 *  own the geometry's `setDrawRange`. */
export function makeOrbitLine(
  points: Float32Array,
  material: THREE.LineBasicMaterial,
  renderOrder: number,
): THREE.Line {
  return configureLinePrimitive(
    new THREE.Line(orbitLineGeometry(points), material), renderOrder);
}

/** A second draw of an existing line's geometry — the local-depth-pass
 *  mirror. Sharing the geometry outright means the drawn prefix and every
 *  vertex rewrite reach both draws with no bookkeeping; the caller still owns
 *  mirroring `position` (anchor drift) and `visible`. */
export function mirrorOrbitLine(
  source: THREE.Line,
  material: THREE.LineBasicMaterial,
  renderOrder: number,
): THREE.Line {
  return configureLinePrimitive(
    new THREE.Line(source.geometry, material), renderOrder);
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

// Anchor drift beyond which trackAnchoredLine rebakes the float32
// buffer. A near-camera vertex carries |drift| in its baked float32
// value, so its worst rounding error is 2^-24 × drift ≈ 28 m at this
// cap — sub-pixel at the tightest body framing in the app (a Mimas
// park, ~500 km range). Raising the cap grows that error linearly.
export const LINE_ANCHOR_MAX_DRIFT_PC = 1.5e-8;

/** Bake anchor-relative float64 vertices into a renderer-local float32
 *  buffer: `out[i] = master[i] + anchor`, summed in float64 so vertices
 *  near the local origin keep sub-metre precision no matter how far the
 *  anchor sits. */
export function bakeAnchoredLineVerts(
  master: Float64Array,
  anchor: Readonly<THREE.Vector3>,
  out: Float32Array,
): void {
  for (let i = 0; i < master.length; i += 3) {
    out[i] = master[i] + anchor.x;
    out[i + 1] = master[i + 1] + anchor.y;
    out[i + 2] = master[i + 2] + anchor.z;
  }
}

const _anchorDelta = new THREE.Vector3();

/**
 * Per-frame tracking for a line whose float32 position buffer is baked
 * renderer-local about `bakedAnchor` (see `bakeAnchoredLineVerts`; a
 * fresh line starts with anchor-relative float32 verts and
 * `bakedAnchor = 0`). Sets `line.position` to the anchor drift so the
 * loop follows its live centre exactly, and rebakes about the current
 * anchor once the drift passes LINE_ANCHOR_MAX_DRIFT_PC.
 *
 * This is the line-primitive arm of the floating-origin discipline: a
 * loop spanning AU-scale extents whose centre rides far from the local
 * origin (a host star's ring under planet focus) otherwise cancels two
 * large float32 quantities per vertex in the shader, and the rounding
 * jitters with every modelview change while the camera moves.
 */
export function trackAnchoredLine(
  line: THREE.Line,
  master: Float64Array,
  bakedAnchor: THREE.Vector3,
  anchor: Readonly<THREE.Vector3>,
): void {
  _anchorDelta.copy(anchor).sub(bakedAnchor);
  if (_anchorDelta.length() > LINE_ANCHOR_MAX_DRIFT_PC) {
    const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    bakeAnchoredLineVerts(master, anchor, attr.array as Float32Array);
    attr.needsUpdate = true;
    bakedAnchor.copy(anchor);
    line.position.set(0, 0, 0);
  } else {
    line.position.copy(_anchorDelta);
  }
}

// A loop or figure with the camera potentially inside it culls unreliably on
// a bounding-sphere test; let the GPU clip per-vertex.
function configureLinePrimitive<T extends THREE.Object3D>(line: T, renderOrder: number): T {
  line.frustumCulled = false;
  line.renderOrder = renderOrder;
  return line;
}

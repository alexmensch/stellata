// Line primitives shared by the orbital-geometry overlays and the
// constellation figure; their materials come from the chrome line seam
// (../chrome-lines/README.md).

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

// Cool blue-white contrasting against the warm-amber galactic disc and the
// additive Milky Way disc without competing with point-source stars. Hue
// 210°, the same as the fresnel shells' `SHELL_RIM_BLUE` — one annotation
// vocabulary across the chrome the local scene draws over itself.
export const ORBIT_LINE_COLOUR = 0x88aacc;

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

/** The viewport / FOV slots a layer needs to size anything in screen pixels,
 *  held **by reference** so a resize or FOV change reaches it with no
 *  bookkeeping. The star pipeline's shared-uniforms map satisfies this
 *  structurally, which is where every consumer's instance comes from. */
export interface ScreenMetricUniforms {
  uViewport: { value: THREE.Vector2 };
  uFovYRad: { value: number };
}

/** `pixelsPerRadian` for the shared uniform slots — the live read, so a layer
 *  never caches a value a resize would stale. */
export function pixelsPerRadianFromUniforms(shared: ScreenMetricUniforms): number {
  return pixelsPerRadianFromFovRad(shared.uFovYRad.value, shared.uViewport.value.y);
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

/** Closed loop through `points`, as an index-closed `THREE.Line` rather
 *  than `THREE.LineLoop` — the WebGPU renderer refuses LineLoop objects
 *  (no line-loop primitive in WGSL), and the index keeps the position
 *  buffer at exactly `points`, so per-frame vertex rewrites and the
 *  anchored-line rebake stay untouched. */
export function makeOrbitLineLoop(
  points: Float32Array,
  material: THREE.Material,
  renderOrder: number,
): THREE.Line {
  const geometry = orbitLineGeometry(points);
  const vertexCount = points.length / 3;
  const index = lineIndexFor(vertexCount, vertexCount + 1);
  for (let i = 0; i < vertexCount; i++) index[i] = i;
  index[vertexCount] = 0;
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return configureLinePrimitive(new THREE.Line(geometry, material), renderOrder);
}

/** An index buffer of `length` entries addressing `vertexCount` vertices.
 *  A 16-bit entry reaches vertex 65535, so the widening turns on the
 *  vertices addressed and never on the entry count, which routinely
 *  exceeds it on a buffer a Uint16Array still indexes. */
function lineIndexFor(vertexCount: number, length: number): Uint16Array | Uint32Array {
  return vertexCount > 65535 ? new Uint32Array(length) : new Uint16Array(length);
}

/** Open polyline through `points` in order — the variant for a traversed
 *  path with two ends (a probe's launch→now trail) rather than a closed
 *  orbit. Callers that draw a growing prefix of a fixed-capacity buffer
 *  own the geometry's `setDrawRange`. */
export function makeOrbitLine(
  points: Float32Array,
  material: THREE.Material,
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
  material: THREE.Material,
  renderOrder: number,
): THREE.Line {
  return configureLinePrimitive(
    new THREE.Line(source.geometry, material), renderOrder);
}

export function makeOrbitLineSegments(
  points: Float32Array,
  material: THREE.Material,
  renderOrder: number,
): THREE.LineSegments {
  return configureLinePrimitive(
    new THREE.LineSegments(orbitLineGeometry(points), material), renderOrder);
}

/** One draw over many closed rings of `segmentsPerRing` vertices each,
 *  laid end to end in `points`. The index closes every ring onto its own
 *  first vertex, so the position buffer keeps one vertex per corner where
 *  the un-indexed form above duplicates each shared endpoint. */
export function makeOrbitRingSegments(
  points: Float32Array,
  segmentsPerRing: number,
  material: THREE.Material,
  renderOrder: number,
): THREE.LineSegments {
  const geometry = orbitLineGeometry(points);
  const vertexCount = points.length / 3;
  const index = lineIndexFor(vertexCount, vertexCount * 2);
  let w = 0;
  for (let base = 0; base < vertexCount; base += segmentsPerRing) {
    for (let i = 0; i < segmentsPerRing; i++) {
      index[w++] = base + i;
      index[w++] = base + ((i + 1) % segmentsPerRing);
    }
  }
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return configureLinePrimitive(
    new THREE.LineSegments(geometry, material), renderOrder);
}

/** An ellipse on two axes of a local frame. `plane` names the two the sweep
 *  runs over and `offset` displaces the ring along the third — 'xy' sweeps
 *  x × y and offsets along z, 'xz' sweeps x × z and offsets along y, 'yz'
 *  sweeps y × z and offsets along x. `radiusA` is the cosine leg. */
export interface RingSpec {
  radiusA: number;
  radiusB: number;
  plane: 'xy' | 'xz' | 'yz';
  offset: number;
}

/** Write one ring's vertices into `out` at `at`, returning the next write
 *  offset. `place` carries each vertex out of the ring's local frame into
 *  the one the buffer holds — a quaternion and centre for a Local Group
 *  object, the galactic-to-ICRS rotation and the GC offset for the disc. */
export function writeRingVerts(
  ring: RingSpec,
  segments: number,
  place: (v: THREE.Vector3) => void,
  out: Float32Array,
  at: number,
): number {
  const tmp = new THREE.Vector3();
  let w = at;
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const a = Math.cos(t) * ring.radiusA;
    const b = Math.sin(t) * ring.radiusB;
    if (ring.plane === 'xy') tmp.set(a, b, ring.offset);
    else if (ring.plane === 'xz') tmp.set(a, ring.offset, b);
    else tmp.set(ring.offset, a, b);
    place(tmp);
    out[w++] = tmp.x;
    out[w++] = tmp.y;
    out[w++] = tmp.z;
  }
  return w;
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

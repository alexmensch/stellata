// Per-planet orbit-ring ellipses for the focused host's planet system.
// See ./README.md § Orbit rings.

import * as THREE from 'three';
import {
  defaultOrbitGeometry,
  type BodyOrbitGeometry,
  type Planet,
  type PlanetSystem,
  type PlanetType,
} from '../planet-system';
import { AU_PC, J2000_OBLIQUITY_RAD } from '../../util/astronomy-constants';
import type { OrbitOrientationRad } from './ephemeris';
import { GALACTIC_NORTH_POLE_ICRS } from '../../galactic/galactic-coords';
import { wrapAngle } from '../../util/angles';
import { mark as perfMark, measure as perfMeasure } from '../../debug/perf-hud';
import type {
  ChromeLineMaterial, ChromeLineMaterials,
} from '../../chrome-lines/chrome-line-materials';
import {
  makeOrbitLineLoop,
  bakeAnchoredLineVerts,
  trackAnchoredLine,
  ORBIT_LINE_COLOUR,
  ORBIT_LINE_OPACITY,
  ORBIT_LINE_SEGMENTS,
  pixelsPerRadian,
  angularRadiusPx,
  FEATURE_LEGIBILITY_MIN_PX,
} from '../../util/orbit-line';

/**
 * North ecliptic pole expressed in ICRS — the normal to Sol's orbital
 * plane, at RA 18h / Dec +66.56° = `(0, −sinε, cosε)`. The y-component is
 * negative: cos(66.56°)·sin(270°) = −sinε. Consumers receive a cloned
 * vector (the exported one is shared) — never mutate this in place.
 */
export const ECLIPTIC_NORTH_POLE_ICRS = new THREE.Vector3(
  0,
  -Math.sin(J2000_OBLIQUITY_RAD),
  Math.cos(J2000_OBLIQUITY_RAD),
);

// Visibility heuristic: ring i renders only when the on-screen pixel gap
// to both of its neighbours — and its own radius — exceeds this threshold.
// The own-radius leg is the shared feature-legibility floor; the same
// value doubles as the inter-ring gap that suppresses the inner-rocky
// pile-up at far framings and lets inner rings re-emerge on close approach.
export const RING_VISIBILITY_THRESHOLD_PX = FEATURE_LEGIBILITY_MIN_PX;

/**
 * Relative element drift a built ring may carry before update() rewrites its
 * vertices — the polyline's OWN resolution, so a skipped rebuild is provably
 * invisible: an `ORBIT_LINE_SEGMENTS`-gon inscribed in the ellipse already
 * departs from it by `a·(π/N)²/2`, and re-deriving before the elements have
 * moved that far only redraws discretisation noise.
 *
 * Self-referential on purpose. The previous gate was elapsed **sim time**
 * (one sim-day), which is not rate-limited by anything: one frame at high
 * fast-forward advances decades, so it degenerated into a full 9-ring,
 * 8192-vertex re-derive plus GPU re-upload every frame while the elements
 * had moved by nothing an eye could resolve.
 */
export const RING_GEOMETRY_DRIFT_TOLERANCE =
  (Math.PI / ORBIT_LINE_SEGMENTS) ** 2 / 2;

/**
 * How far the body's eccentric anomaly may run past the vertex the ring
 * was anchored on before that ring is rewritten.
 *
 * Anchoring is only worth anything while it stays fresh. A body that has
 * advanced a fraction `f` of one vertex interval sits `4f(1−f)` of the
 * full chord sagitta off the polyline, so holding the offset inside the
 * bound the other legs already use needs `f ≤ 0.146`; an eighth is that
 * with margin. Costed in rewrites, an eighth of a vertex interval is 1.4
 * days of Pluto, 8 minutes of Earth and 36 seconds of the Moon — rare at
 * 1×, every frame under heavy scrub, which is the regime the planet rings
 * were already in.
 */
export const RING_PHASE_ANCHOR_TOLERANCE =
  (2 * Math.PI) / ORBIT_LINE_SEGMENTS / 8;

const DEG = Math.PI / 180;

interface PlanetRing {
  readonly planet: Planet;
  readonly line: THREE.Line;
  // Centre-relative float64 vertices (the element-source truth); the
  // line's float32 GPU buffer is baked renderer-local from these about
  // `bakedCentre` (util/orbit-line.ts trackAnchoredLine).
  readonly master: Float64Array;
  readonly verts: Float32Array;
  readonly bakedCentre: THREE.Vector3;
  // Live renderer-local centre this frame (host, or host + parent
  // offset for a moon).
  readonly centre: THREE.Vector3;
  // Index into ps.planets of the centre body (a moon's parent); null =
  // host-centred. A moon's line rides its parent's live host-relative
  // offset each frame; its visibility group measures camera→parent.
  readonly parentIdx: number | null;
  // Cached for the visibility heuristic. The on-screen extent of an
  // elliptical orbit is bounded by the semi-major axis at every viewing
  // angle, so we use it as the per-ring "characteristic size" the
  // pixel-gap test compares.
  semiMajorPc: number;
  // The geometry `master` was written from. update() compares the live
  // elements against it and rewrites only on resolvable drift.
  built: BodyOrbitGeometry;
}

/**
 * Whether the live elements have moved far enough from the ones a ring's
 * vertices were written from to be worth rewriting them. Every leg is
 * relative to the semi-major axis, so one tolerance covers a 0.4 AU Mercury
 * ring and a 39 AU Pluto one: `a` and `e` compare directly (`e` scales the
 * radius by `a·Δe`), and each angle contributes its own arc `a·Δθ`.
 */
export function ringGeometryDrifted(
  built: BodyOrbitGeometry,
  live: BodyOrbitGeometry,
  tolerance = RING_GEOMETRY_DRIFT_TOLERANCE,
): boolean {
  if (Math.abs(live.aAu - built.aAu) > tolerance * built.aAu) return true;
  if (Math.abs(live.e - built.e) > tolerance) return true;
  const a = built.orientation;
  const b = live.orientation;
  if (Math.abs(b.inclination - a.inclination) > tolerance
    || Math.abs(b.longAscNode - a.longAscNode) > tolerance
    || Math.abs(b.argPerihelion - a.argPerihelion) > tolerance) return true;
  // The phase leg has its own, much looser tolerance: it is not asking
  // whether the ELLIPSE moved (it has not) but whether the body has run
  // far enough along it to fall off the vertex the polyline was anchored
  // on. Sharing the shape tolerance here would rewrite every ring every
  // frame, since a body crosses that much phase almost immediately.
  if (live.eccentricAnomaly === undefined || built.eccentricAnomaly === undefined) {
    return false;
  }
  return Math.abs(wrapAngle(live.eccentricAnomaly - built.eccentricAnomaly))
    > RING_PHASE_ANCHOR_TOLERANCE;
}

/**
 * Resolve the orbital plane normal for a host star. Sol's planets ride
 * the ecliptic (J2000 obliquity tilt against ICRS); every other host
 * defaults to the galactic plane.
 *
 * `solIndex` is passed in rather than reading the catalog so this function
 * stays pure — easy to test, reusable from any layer that needs the
 * same per-host plane decision.
 */
export function orbitalPlaneNormalFor(
  hostStarIdx: number,
  solIndex: number,
): THREE.Vector3 {
  if (hostStarIdx === solIndex) return ECLIPTIC_NORTH_POLE_ICRS.clone();
  return GALACTIC_NORTH_POLE_ICRS.clone();
}

/**
 * Compute the visibility flags for a sequence of rings ordered by
 * increasing pixel radius. Pure function — extracted so the heuristic
 * can be unit-tested independently of three.js scene state.
 *
 * Ring i renders when its pixel-radius gap to both neighbours exceeds
 * `thresholdPx` AND its own radius does. The innermost and outermost
 * rings only have one neighbour each; their single gap must exceed the
 * threshold. The own-radius floor is what suppresses a lone sub-pixel
 * ring (a single-moon parent seen from across the system) — a lone ring
 * has no neighbour gap to fail.
 */
export function ringVisibility(
  pixelRadii: readonly number[],
  thresholdPx: number,
): boolean[] {
  const out: boolean[] = new Array(pixelRadii.length).fill(false);
  for (let i = 0; i < pixelRadii.length; i++) {
    const gapPrev = i > 0 ? pixelRadii[i] - pixelRadii[i - 1] : Infinity;
    const gapNext = i < pixelRadii.length - 1 ? pixelRadii[i + 1] - pixelRadii[i] : Infinity;
    out[i] = Math.min(gapPrev, gapNext) > thresholdPx && pixelRadii[i] > thresholdPx;
  }
  return out;
}

/**
 * Build the vertices of one Keplerian ellipse with the host star at one
 * focus and the perihelion along local +x. Pure / scene-agnostic so the
 * geometry can be unit-tested on the CPU.
 *
 * - `aPc` — semi-major axis in parsecs.
 * - `e`  — orbital eccentricity, in [0, 1).
 * - `segments` — number of points around the loop.
 * - `out` — buffer of length `segments * 3` (xyz triples). The
 *   ellipse is laid out in the local xy plane (z = 0); the caller
 *   rotates it into the host's orbital plane afterwards.
 * - `startEccAnomalyRad` — where vertex 0 sits. The loop parameter IS the
 *   eccentric anomaly here (x = a·cos E − ae, y = b·sin E), so passing the
 *   body's own E puts a vertex exactly ON the body.
 *
 * That last argument is what stops a focused planet swimming against its
 * own ring. The body lies on the true ellipse; the ring is an inscribed
 * `segments`-gon that falls up to `a·(π/N)²/2` inside it — 429 km at
 * Pluto, a third of its radius — and the offset cycles 0 → max → 0 as the
 * body crosses each vertex, which reads as the ring drifting while the
 * planet is held still. Anchored, the offset is identically zero.
 */
export function buildEllipsePoints(
  aPc: number,
  e: number,
  segments: number,
  out: Float32Array | Float64Array,
  startEccAnomalyRad = 0,
): void {
  const b = aPc * Math.sqrt(1 - e * e);
  const c = aPc * e;
  for (let i = 0; i < segments; i++) {
    const t = startEccAnomalyRad + (i / segments) * Math.PI * 2;
    out[i * 3 + 0] = aPc * Math.cos(t) - c;
    out[i * 3 + 1] = b * Math.sin(t);
    out[i * 3 + 2] = 0;
  }
}

/**
 * Placeholder eccentric anomaly for the i-th planet of an N-planet
 * system. Spreads bodies evenly around their respective orbits so all
 * N don't pile up at perihelion (+x). Used by PlanetBodyField as the
 * fallback when a host's PlanetSystem doesn't supply a positionsAt
 * resolver. Deterministic — re-running with the same i and N produces
 * the same angle.
 */
export function placeholderEccentricAnomaly(i: number, n: number): number {
  if (n <= 0) return 0;
  return (i / n) * Math.PI * 2;
}

/**
 * Local-frame position of a planet at a given eccentric anomaly.
 * Pure helper used by the placeholder fallback path in PlanetBodyField.
 *
 * `out` is mutated and returned for convenience.
 */
export function planetLocalPosition(
  semiMajorAxisAu: number,
  eccentricity: number,
  eccentricAnomaly: number,
  orientation: THREE.Quaternion,
  out: THREE.Vector3,
): THREE.Vector3 {
  const a = semiMajorAxisAu * AU_PC;
  const b = a * Math.sqrt(1 - eccentricity * eccentricity);
  const c = a * eccentricity;
  out.set(
    a * Math.cos(eccentricAnomaly) - c,
    b * Math.sin(eccentricAnomaly),
    0,
  );
  out.applyQuaternion(orientation);
  return out;
}

/**
 * Map a planet type to a shader solidity factor. Consumed by
 * PlanetBodyField as a per-instance attribute; the planet fragment
 * shader interpolates the inner-edge fade window between gas-giant
 * softness and rocky sharpness on this value.
 */
export function solidityForType(type: PlanetType): number {
  switch (type) {
    case 'rocky': return 1.0;
    case 'icy': return 1.0;
    case 'ice_giant': return 0.4;
    case 'gas_giant': return 0.0;
  }
}

const COMPOSE_ORBIT_Z = new THREE.Vector3(0, 0, 1);
const COMPOSE_ORBIT_X = new THREE.Vector3(1, 0, 0);
const _composeQNode = new THREE.Quaternion();
const _composeQIncl = new THREE.Quaternion();
const _composeQPeri = new THREE.Quaternion();

/**
 * Compose `Rz(Ω)·Rx(I)·Rz(ω)` — the standard orbital-frame → host-plane
 * rotation — into `out`. Same composition `ephemeris.planetEclipticAU`
 * applies to in-plane (x', y') scalars; lifted here so ring vertices
 * (in `setPlanetSystem`) and PlanetBodyField's body positions share one
 * implementation. Returns `out` for convenience.
 */
export function composeOrbitOrientationQuat(
  oi: OrbitOrientationRad,
  out: THREE.Quaternion,
): THREE.Quaternion {
  _composeQNode.setFromAxisAngle(COMPOSE_ORBIT_Z, oi.longAscNode);
  _composeQIncl.setFromAxisAngle(COMPOSE_ORBIT_X, oi.inclination);
  _composeQPeri.setFromAxisAngle(COMPOSE_ORBIT_Z, oi.argPerihelion);
  return out.copy(_composeQNode).multiply(_composeQIncl).multiply(_composeQPeri);
}

const _refQuatA = new THREE.Quaternion();
const _refQuatB = new THREE.Quaternion();

/**
 * Reference-plane → ecliptic rotation for a moon's element frame, from
 * the plane's ICRS pole: `Rx(−ε)·Rz(90°+α0)·Rx(90°−δ0)` — the quaternion
 * form of the scalar chain in `moonOffsetEcliptic`, so a ring built with
 * it lies in the same plane the moon resolver moves the body in
 * (parity vitest-pinned). Returns `out`.
 */
export function refPlaneToEclipticQuat(
  refPoleRaDeg: number,
  refPoleDecDeg: number,
  out: THREE.Quaternion,
): THREE.Quaternion {
  out.setFromAxisAngle(COMPOSE_ORBIT_X, -J2000_OBLIQUITY_RAD);
  out.multiply(_refQuatA.setFromAxisAngle(COMPOSE_ORBIT_Z, (90 + refPoleRaDeg) * DEG));
  out.multiply(_refQuatB.setFromAxisAngle(COMPOSE_ORBIT_X, (90 - refPoleDecDeg) * DEG));
  return out;
}

const _writeQuat = new THREE.Quaternion();
const _writePlaneQuat = new THREE.Quaternion();
const _writeVec = new THREE.Vector3();

/**
 * Fill `verts` with one body's orbit-ring loop in ICRS-aligned local
 * space: canonical focus-at-origin ellipse → Rz(Ω)·Rx(I)·Rz(ω) →
 * (moon reference plane → host plane, when the geometry carries a ref
 * pole) → host plane → ICRS via `hostQuat`. Returns the semi-major
 * axis in pc (the visibility heuristic's characteristic size).
 */
export function writeRingVerts(
  verts: Float32Array | Float64Array,
  g: BodyOrbitGeometry,
  hostQuat: Readonly<THREE.Quaternion>,
): number {
  const aPc = g.aAu * AU_PC;
  buildEllipsePoints(aPc, g.e, ORBIT_LINE_SEGMENTS, verts, g.eccentricAnomaly ?? 0);
  _writeQuat.copy(hostQuat);
  if (g.refPoleRaDeg !== undefined && g.refPoleDecDeg !== undefined) {
    _writeQuat.multiply(
      refPlaneToEclipticQuat(g.refPoleRaDeg, g.refPoleDecDeg, _writePlaneQuat),
    );
  }
  _writeQuat.multiply(composeOrbitOrientationQuat(g.orientation, _writePlaneQuat));
  for (let i = 0; i < ORBIT_LINE_SEGMENTS; i++) {
    _writeVec.set(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
    _writeVec.applyQuaternion(_writeQuat);
    verts[i * 3 + 0] = _writeVec.x;
    verts[i * 3 + 1] = _writeVec.y;
    verts[i * 3 + 2] = _writeVec.z;
  }
  return aPc;
}

export class OrbitRingsLayer {
  readonly group: THREE.Group;
  private rings: PlanetRing[] = [];
  private ps: PlanetSystem | null = null;
  private hostQuat = new THREE.Quaternion();
  private mono = false;
  private hidden = false;
  // Detail-cycle permission (floor 'representational'). AND'd with the
  // focus/warp/chart gates — false hides the rings even when a host is
  // focused. Sibling of `hidden` / `mono`.
  private permitted = true;
  private readonly tmpParentRel = new THREE.Vector3();
  // Last host renderer-local position update() received; retained so a
  // null feed (host not attached yet) keeps the rings where they were.
  private readonly hostLocal = new THREE.Vector3();

  private readonly stroke: ChromeLineMaterial;

  constructor(chromeLines: ChromeLineMaterials) {
    this.stroke = chromeLines.solid(ORBIT_LINE_COLOUR, ORBIT_LINE_OPACITY, true);
    this.group = new THREE.Group();
    // Local-depth-pass in-pass order: after the planet disc mirrors (3)
    // so ring fragments depth-test against real body depth — near-side
    // arcs draw over a disc/mesh, far-side arcs depth-fail — and before
    // the star glow mirror (3.5) so the host's halo adds over the
    // lines. See src/client/local-depth/README.md.
    this.group.renderOrder = 3.2;
    this.group.visible = false;
  }

  /**
   * Replace the active planet system. Pass null to tear the rings down
   * (e.g. when focus clears or moves to a host without planets).
   * Geometry is disposed eagerly — Three.js doesn't reclaim it
   * otherwise. `t` is the model clock — ring geometry
   * derives from the system's live element source at `t`, and update()
   * rewrites it once the elements drift past what the polyline resolves
   * (`RING_GEOMETRY_DRIFT_TOLERANCE`).
   */
  setPlanetSystem(ps: PlanetSystem | null, solIndex: number, t: number): void {
    this.disposeRings();
    this.ps = ps;
    // Fresh system: centres park at the origin until the first update()
    // feeds the live host position — a star focus recentres the origin
    // onto the host, so this is exact there and one-frame-stale at
    // worst under planet focus.
    this.hostLocal.set(0, 0, 0);
    if (ps === null || ps.planets.length === 0) {
      this.group.visible = false;
      return;
    }

    const planeNormal = orbitalPlaneNormalFor(ps.hostStarIdx, solIndex);
    this.hostQuat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), planeNormal);

    const geoms = ps.orbitGeometryAt?.(t) ?? defaultOrbitGeometry(ps.planets);
    for (let pIdx = 0; pIdx < ps.planets.length; pIdx++) {
      const g = geoms[pIdx];
      const master = new Float64Array(ORBIT_LINE_SEGMENTS * 3);
      const semiMajorPc = writeRingVerts(master, g, this.hostQuat);
      const verts = new Float32Array(master);
      const line = makeOrbitLineLoop(
        verts, this.stroke.material, this.group.renderOrder);
      this.group.add(line);
      this.rings.push({
        planet: ps.planets[pIdx],
        line,
        master,
        verts,
        bakedCentre: new THREE.Vector3(),
        centre: new THREE.Vector3(),
        parentIdx: g.parentIdx,
        semiMajorPc,
        built: g,
      });
    }

    this.group.visible = !this.hidden && !this.mono && this.permitted;
  }

  /**
   * Re-derive ring geometry from the live element source — **every ring,
   * host-centred and parent-centred alike**.
   *
   * Call only AFTER the visibility pass: this skips rings nothing is
   * drawing, and with every ring sub-pixel it never evaluates the
   * elements at all. Why the drift gate rather than a skip by body kind,
   * and what it costs per body: see README.md § Orbit rings.
   */
  private refreshGeometry(t: number): void {
    if (!this.rings.some((r) => r.line.visible)) return;
    const geoms = this.ps?.orbitGeometryAt?.(t);
    if (!geoms) return;
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (!r.line.visible) continue;
      if (!ringGeometryDrifted(r.built, geoms[i])) continue;
      r.semiMajorPc = writeRingVerts(r.master, geoms[i], this.hostQuat);
      r.built = geoms[i];
      bakeAnchoredLineVerts(r.master, r.bakedCentre, r.verts);
      (r.line.geometry.getAttribute('position') as THREE.BufferAttribute)
        .needsUpdate = true;
    }
  }

  /**
   * Per-frame visibility update. `hostLocalPos` is the host star's
   * renderer-local position (PlanetBodyField's hostLocalPos, so rings
   * stay glued to the same centre the bodies orbit) — under planet
   * focus the floating origin sits on the PLANET, not the host, so the
   * host is generally NOT at the local origin. Pass null while the
   * host isn't attached yet; the rings then stay where they were.
   *
   * `parentRelInto` supplies a body's live host-relative offset (the
   * field's iLocalRel) — a moon's ring rides its parent through it, and
   * its visibility group measures camera→parent. A moon ring hides
   * whenever the offset is unavailable.
   */
  update(
    camera: THREE.PerspectiveCamera,
    viewportHeightPx: number,
    hostLocalPos: Readonly<THREE.Vector3> | null,
    t: number,
    parentRelInto?: (planetIdx: number, out: THREE.Vector3) => boolean,
  ): void {
    if (this.hidden || this.mono || !this.permitted || this.rings.length === 0) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    perfMark('solar.rings');
    if (hostLocalPos) this.hostLocal.copy(hostLocalPos);

    const pxPerRad = pixelsPerRadian(camera.fov, viewportHeightPx);
    const dHost = camera.position.distanceTo(this.hostLocal);
    // The pixel-gap heuristic runs per centre body: host-centred rings
    // gap against each other; each parent's moon rings form their own
    // group measured at the parent's distance (key = parentIdx).
    const groups = new Map<number, { idxs: number[]; radii: number[] }>();
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      r.centre.copy(this.hostLocal);
      let dPc = dHost;
      if (r.parentIdx !== null) {
        if (!parentRelInto || !parentRelInto(r.parentIdx, this.tmpParentRel)) {
          r.line.visible = false;
          continue;
        }
        r.centre.add(this.tmpParentRel);
        dPc = r.centre.distanceTo(camera.position);
      }
      const key = r.parentIdx ?? -1;
      let group = groups.get(key);
      if (!group) {
        group = { idxs: [], radii: [] };
        groups.set(key, group);
      }
      group.idxs.push(i);
      group.radii.push(angularRadiusPx(r.semiMajorPc, dPc, pxPerRad));
    }
    for (const g of groups.values()) {
      const visible = ringVisibility(g.radii, RING_VISIBILITY_THRESHOLD_PX);
      for (let k = 0; k < g.idxs.length; k++) {
        this.rings[g.idxs[k]].line.visible = visible[k];
      }
    }
    // Geometry and position passes both run after visibility, so an
    // invisible ring pays neither a rewrite nor a rebake. A ring flipping
    // visible gets both the same frame.
    this.refreshGeometry(t);
    for (const r of this.rings) {
      if (!r.line.visible) continue;
      trackAnchoredLine(r.line, r.master, r.bakedCentre, r.centre);
    }
    perfMeasure('solar.rings');
  }

  /**
   * True when at least one orbit ring is currently being rendered.
   * The focus ring overlay reads this each frame to suppress itself
   * when the orbit rings are already identifying the focused host.
   */
  anyOrbitRingVisible(): boolean {
    if (this.hidden || this.mono || !this.permitted || !this.group.visible) return false;
    for (const r of this.rings) {
      if (r.line.visible) return true;
    }
    return false;
  }

  /**
   * True when the orbit ring for planet `i` is currently rendering. The
   * planet-labels overlay gates label visibility on this per-planet flag
   * so labels appear only when their associated ring does.
   *
   * Crucially: labels follow rings, NOT body apparent-magnitude. A
   * planet whose body is below the slider cutoff still shows a label
   * if its ring is up — labels answer "what would I be seeing here,"
   * not "what am I currently rendering."
   */
  isOrbitRingVisible(i: number): boolean {
    if (this.hidden || this.mono || !this.permitted || !this.group.visible) return false;
    if (i < 0 || i >= this.rings.length) return false;
    return this.rings[i].line.visible;
  }

  /**
   * Detail-cycle permission (declutter). Independent of `setHidden`
   * (warp) and `setMonochrome` (chart) — all three AND into visibility.
   */
  setPermitted(on: boolean): void {
    this.permitted = on;
    if (!on) this.group.visible = false;
  }

  /**
   * Suppress the layer entirely (used during warp transitions, where
   * orbit-ring context is exactly the kind of detail the warp blur
   * intentionally drops).
   */
  setHidden(on: boolean): void {
    this.hidden = on;
    if (on) this.group.visible = false;
  }

  /**
   * Chart (mono / paper) mode hides the rings — flat hard-edged orbital
   * ellipses are a chart-mode rendering decision tracked in
   * chart-mode, not this generic layer.
   */
  setMonochrome(on: boolean): void {
    this.mono = on;
    if (on) this.group.visible = false;
  }

  dispose(): void {
    this.disposeRings();
    this.stroke.dispose();
  }

  // Runs on every rebuild, so the layer's shared stroke outlives it —
  // only `dispose` frees that.
  private disposeRings(): void {
    for (const r of this.rings) {
      this.group.remove(r.line);
      r.line.geometry.dispose();
    }
    this.rings = [];
  }
}

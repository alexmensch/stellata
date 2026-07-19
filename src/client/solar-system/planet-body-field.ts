// Global instanced planet-body field across every attached host. See
// src/client/solar-system/README.md § Planet rendering.

import * as THREE from 'three';
import { systemFamily, type Planet, type PlanetSystem } from './planet-system';
import {
  alphaZeroPhaseFactor,
  phaseFactorFor,
} from './phase-function';
import { applyDiscBlendDefaults, applyGlowBlendDefaults } from '../star-pipeline/star-pipeline';
import {
  pickChartDiscUniforms,
  pickPerceptualDiscUniforms,
  type ChartDiscUniforms,
  type PerceptualDiscUniforms,
} from '../star-pipeline/perceptual-disc-uniforms';
import { chartDiscPxForAppMag } from '../chart-mode/chart-disc-pure';
import { AU_PC, KM_PC } from '../util/astronomy-constants';
import { DISC_FADE_END_RATIO, DISC_FADE_START_RATIO } from './mesh-crossfade';
import {
  orbitalPlaneNormalFor,
  placeholderEccentricAnomaly,
  planetLocalPosition,
  solidityForType,
} from './orbit-rings-layer';
import {
  perceptualAppSizePx,
  perceptualDmEff,
  planetApparentMagnitude,
  SOFT_TAPER_MARGIN_MAG,
} from './perceptual-magnitude';
import {
  MIN_DISC_HIT_RADIUS_PX,
  pickFromCandidates,
  physSizePx,
  type PickCandidate,
} from '../camera/controls/star-geometry';
import type { HoverHit } from '../hover/hover-types';
import { projectToScreen } from '../overlays/overlay-project';
import {
  blendDimBuffer,
  dimBlendFactor,
  eclipseDimFromOffsets,
} from '../binaries/eclipse-photometry-pure';
import { ECLIPSE_DIM_TAU_S } from '../binaries/binary-tuning';
import { parentIndexOf } from './orbit-descriptor';
import planetVert from './planet.vert.glsl?raw';
import planetFrag from './planet.frag.glsl?raw';

/** Screen separation below which a body reads as one point with its
 *  parent (host star / parent planet). Deliberately looser than the
 *  binary orbit walk's 1.5 px render-LOD gate: planet and moon dots
 *  carry ~2–4 px glow footprints and 4 px hit radii, so a few px of
 *  separation still reads as a single blob to the eye. Iterated at
 *  smoke. */
export const BODY_COLLAPSE_THRESHOLD_PX = 6;

// Initial slot capacity. v1 attaches Sol (9 planets + 18 moons = 27
// bodies) once; sized to hold that in one shot so the sole attach doesn't
// immediately grow. bk5 may grow this as exoplanet hosts come online.
// Resizing reallocates the instanced attribute buffers — relatively cheap
// compared to a frame.
const INITIAL_CAPACITY = 32;

interface InstanceAttrSpec {
  /** GLSL attribute name. */
  attr: string;
  /** Floats per instance. */
  dims: number;
  /** THREE.DynamicDrawUsage hint for per-frame-rewritten buffers. */
  dynamicUsage?: boolean;
  /** Initial fill value (buffers default to 0). */
  fill?: number;
}

// Identity helper: preserves the literal key union (so `bufs` access
// is typo-checked) while widening values to InstanceAttrSpec (so the
// optional fields are readable on every row).
const attrSpecs = <K extends string>(s: Record<K, InstanceAttrSpec>) => s;

/** One row per per-instance GPU attribute: `key` names the CPU-side
 *  Float32Array in `bufs`, `attr` the shader attribute. Allocation,
 *  grow-copy, geometry binding, full flush, and detach compaction all
 *  iterate this table — a new attribute is one row here plus its
 *  write site. */
const INSTANCE_ATTR_SPECS = attrSpecs({
  localRel: { attr: 'iLocalRel', dims: 3 },
  hostLocalPos: { attr: 'iHostLocalPos', dims: 3 },
  radius: { attr: 'iRadiusPc', dims: 1 },
  colour: { attr: 'iColour', dims: 3 },
  solidity: { attr: 'iSolidity', dims: 1 },
  albedo: { attr: 'iAlbedoP', dims: 1 },
  hostAbsmag: { attr: 'iHostAbsmag', dims: 1 },
  phaseA: { attr: 'iPhaseCoefsA', dims: 4 },
  phaseB: { attr: 'iPhaseCoefsB', dims: 4 },
  phaseC: { attr: 'iPhaseCoefsC', dims: 4 },
  eclipseDim: { attr: 'iEclipseDim', dims: 1, dynamicUsage: true, fill: 1 },
});

type InstanceBufKey = keyof typeof INSTANCE_ATTR_SPECS;

const SPEC_ENTRIES = Object.entries(INSTANCE_ATTR_SPECS) as readonly [
  InstanceBufKey,
  InstanceAttrSpec,
][];

/**
 * Maximum d_v_p at which any planet of an attached host could plausibly
 * cross the magnitude cutoff. Closed-form solution of the apparent-mag
 * equation evaluated at the brightest planet's `p · (R/a)²` (the
 * geometry-independent reflectance proxy):
 *
 *   m_planet ≈ M_host + 5·log10(d/10) − 2.5·log10(p · (R/a)²)
 *
 * Set m_planet = maxAppMag and solve for d:
 *
 *   d_cull = 10 pc · √(p · (R/a)²) · 10^((maxAppMag − M_host) / 5)
 *         = 10 pc · sqrt(p) · (R/a) · 10^((maxAppMag − M_host) / 5)
 *
 * The caller folds `alphaZeroPhaseFactor(coefs)` into
 * `brightestReflectance` before passing it in (see `attachHost`). For
 * most planets that's a 1× no-op (c0 = 0 ⇒ φ(0) = 1); Saturn's c0 =
 * −0.55 ring boost lifts φ(0) to ~1.66, widening Saturn's cull by
 * ~√1.66 ≈ 1.29×. The cull remains a conservative outer bound: at any
 * α the actual flux factor is ≤ φ(0) plus a sub-millimagnitude Venus
 * polynomial-peak margin, so a host past d_cull is sub-cutoff.
 *
 * Pure function — exported for tests.
 */
export function cullDistancePc(
  hostAbsmag: number,
  brightestReflectance: number,
  maxAppMag: number,
): number {
  if (brightestReflectance <= 0) return 0;
  const distanceFactor = 10 ** ((maxAppMag - hostAbsmag) / 5);
  return 10 * Math.sqrt(brightestReflectance) * distanceFactor;
}

interface AttachedHost {
  hostStarIdx: number;
  ps: PlanetSystem;
  hostAbsmag: number;
  /** Host star's physical radius in pc — the occluding disc of the
   *  true-eclipse dim. */
  hostRadiusPc: number;
  /** Absolute (catalog-space) host position in pc. Static for the
   *  session — used to recompute hostLocalPos whenever worldOffset
   *  changes. */
  hostAbsPos: THREE.Vector3;
  /** Cached host-local-frame position (= hostAbsPos − worldOffset). */
  hostLocalPos: THREE.Vector3;
  /** ICRS-aligned orbital-plane orientation for this host. */
  orientation: THREE.Quaternion;
  positionsAt: ((t: number, out: Float32Array) => void) | null;
  positionsScratch: Float32Array | null;
  /** max over planets of `p · (R / a)² · alphaZeroPhaseFactor(coefs)`
   *  — the geometry-independent reflectance proxy folded with each
   *  planet's α=0 phase boost. Drives cullDistancePc. Saturn's ring
   *  c0 lifts its term above the globe-only reflectance; for every
   *  other planet alphaZeroPhaseFactor = 1. */
  brightestReflectance: number;
  /** Cached cull distance for the current maxAppMag. */
  cullDistance: number;
  /** Slot range in the global instanced buffer. */
  startInstance: number;
  count: number;
}

// Per-candidate row in the cross-host pick reducer. Extends the shared
// `PickCandidate` shape so `pickFromCandidates` in star-geometry.ts
// reduces it under the same prime/fallback contract every layered
// picker uses. `idx` is the planet-within-host index (decoded from the
// winning candidate as `hostStarIdx + idx`); the host axis rides
// through on `hostStarIdx`.
type CrossHostCandidate = PickCandidate & {
  hostStarIdx: number;
  cameraDistancePc: number;
};

export class PlanetBodyField {
  readonly group: THREE.Group;
  private readonly localMirrorGroup = new THREE.Group();
  private mono = false;
  private hidden = false;
  private hosts = new Map<number, AttachedHost>();
  private capacity = INITIAL_CAPACITY;
  private liveCount = 0;
  private worldOffset = new THREE.Vector3();
  private maxAppMag: number;
  // Shared uniform bundle — references, not copies. The picker reads
  // current values directly so it stays in lockstep with the shaders
  // and any debug-panel writes to the same `{ value }` slots.
  private magShared: PerceptualDiscUniforms & ChartDiscUniforms;
  // Per-instance attribute buffers keyed per INSTANCE_ATTR_SPECS.
  // Re-allocated on capacity grow.
  private bufs!: Record<InstanceBufKey, Float32Array>;
  private dimTargets = new Map<number, number>();
  private dimActive = new Set<number>();
  private lastDimNowMs: number | null = null;
  // Reverse index: flat instance → owning hostStarIdx (-1 = unused
  // slot). Rebuilt on every attach/detach so the flat-index accessors
  // resolve their host in O(1) instead of an O(hosts) scan — several
  // run per-frame (focal ride, POI overlay per pin, focus-card rows).
  private instanceHost!: Int32Array;
  private geometry!: THREE.InstancedBufferGeometry;
  private matDisc!: THREE.ShaderMaterial;
  private matGlow!: THREE.ShaderMaterial;
  private matCore!: THREE.ShaderMaterial;
  private matDiscLocal!: THREE.ShaderMaterial;
  private matGlowLocal!: THREE.ShaderMaterial;
  private meshDisc!: THREE.Mesh;
  private meshGlow!: THREE.Mesh;
  private meshCore!: THREE.Mesh;
  private meshDiscLocal!: THREE.Mesh;
  private meshGlowLocal!: THREE.Mesh;
  // One shared { value } slot across every material — the uHideIdx
  // uniform hiding the observe-anchor body (-1 = none).
  private hideIdxUniform = { value: -1 };
  // Active local-depth cluster's slot range (start, count); (-1, 0) =
  // none. One shared value drives the main-pass suppression AND the
  // mirror draws' member gate (opposite sense, keyed on the
  // LOCAL_DEPTH_PASS define).
  private localPassRangeUniform = { value: new Int32Array([-1, 0]) };
  // Reusable scratch — avoids per-frame allocation in update().
  private rotateTmp = new THREE.Vector3();

  constructor(magnitudeShared: PerceptualDiscUniforms & ChartDiscUniforms) {
    this.magShared = magnitudeShared;
    this.maxAppMag = magnitudeShared.uMaxAppMag.value;
    this.group = new THREE.Group();
    this.group.visible = false;
    // PlanetBodyField sits in the renderer's local frame (no group
    // translation). iHostLocalPos delivers each host's offset from
    // world-local origin per-instance; the shader does the rest.
    this.allocateBuffers(this.capacity);
    this.buildGeometry();
    this.buildMaterials(magnitudeShared);
  }

  /**
   * Attach a planet system to the global field. Idempotent — calling
   * with an already-attached host idx replaces its data without
   * compacting the buffer (the new instance range may shift).
   *
   * `hostAbsPos` is the host's absolute (catalog-space) position in
   * pc. The class converts to local-frame each time `recenter()`
   * fires.
   */
  attachHost(
    hostStarIdx: number,
    ps: PlanetSystem,
    hostAbsmag: number,
    hostRadiusPc: number,
    hostAbsPos: Readonly<THREE.Vector3>,
    solIndex: number,
    t: number,
  ): void {
    if (ps.planets.length === 0) return;
    if (this.hosts.has(hostStarIdx)) this.detachHost(hostStarIdx);

    const n = ps.planets.length;
    while (this.liveCount + n > this.capacity) {
      this.growCapacity();
    }

    const planeNormal = orbitalPlaneNormalFor(ps.hostStarIdx, solIndex);
    const orientation = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      planeNormal,
    );

    let brightestReflectance = 0;
    for (const planet of ps.planets) {
      const aPc = planet.semiMajorAxisAu * AU_PC;
      const RoverA = (planet.radiusKm * KM_PC) / Math.max(aPc, 1e-30);
      // Saturn's rings raise its α=0 brightness above globe-only
      // reflectance via the Mallama c0 term — fold it into the cull
      // proxy so the cull distance widens to match. Other planets
      // have c0=0 ⇒ α=0 factor 1, leaving the formula unchanged.
      const phiZero = alphaZeroPhaseFactor(planet.phaseCoefficients);
      const refl = planet.albedo * RoverA * RoverA * phiZero;
      if (refl > brightestReflectance) brightestReflectance = refl;
    }

    const host: AttachedHost = {
      hostStarIdx,
      ps,
      hostAbsmag,
      hostRadiusPc,
      hostAbsPos: new THREE.Vector3().copy(hostAbsPos),
      hostLocalPos: new THREE.Vector3().copy(hostAbsPos).sub(this.worldOffset),
      orientation,
      positionsAt: ps.positionsAt ?? null,
      positionsScratch: ps.positionsAt ? new Float32Array(n * 3) : null,
      brightestReflectance,
      cullDistance: cullDistancePc(hostAbsmag, brightestReflectance, this.maxAppMag),
      startInstance: this.liveCount,
      count: n,
    };
    this.hosts.set(hostStarIdx, host);
    this.liveCount += n;
    this.rebuildInstanceMap();
    this.resetEclipseDims();

    // Initial fill — bodies, host position, and one immediate
    // ephemeris-or-placeholder pass so the first frame after attach
    // has valid iLocalRel data.
    this.writeHostStaticAttributes(host);
    this.writeHostPositions(host, t);
    this.flushAllAttributes();
    this.geometry.instanceCount = this.liveCount;
    this.group.visible = !this.hidden;
  }

  detachHost(hostStarIdx: number): void {
    const host = this.hosts.get(hostStarIdx);
    if (!host) return;
    // Compact: shift any later hosts down to fill the gap so the
    // buffer stays packed. v1 only ever attaches Sol once and never
    // detaches, so this path is exercised by future bk5 lifecycle
    // changes — keep the implementation simple, not blazing fast.
    const tailStart = host.startInstance + host.count;
    const shiftCount = this.liveCount - tailStart;
    if (shiftCount > 0) {
      this.shiftInstancesDown(tailStart, shiftCount, host.count);
      for (const h of this.hosts.values()) {
        if (h.startInstance >= tailStart) {
          h.startInstance -= host.count;
        }
      }
    }
    this.liveCount -= host.count;
    this.geometry.instanceCount = this.liveCount;
    this.flushAllAttributes();
    this.hosts.delete(hostStarIdx);
    this.rebuildInstanceMap();
    this.resetEclipseDims();
    if (this.liveCount === 0) this.group.visible = false;
  }

  /** Attach/detach shifts flat indices, invalidating any mid-decay dim
   *  slot the active set points at — reset the whole buffer to 1
   *  (correct within one anti-strobe time constant, and attach/detach
   *  is a rare lifecycle event, not a per-frame path). */
  private resetEclipseDims(): void {
    this.bufs.eclipseDim.fill(1);
    this.dimActive.clear();
    this.dimTargets.clear();
  }

  /**
   * Adjust each attached host's local-frame position when the
   * floating-origin shifts. Cheap — a vector subtract per host plus
   * a buffer write. Called once by `Stellata.recenterOrigin`.
   */
  recenter(newWorldOffset: Readonly<THREE.Vector3>): void {
    if (newWorldOffset.equals(this.worldOffset)) return;
    this.worldOffset.copy(newWorldOffset);
    for (const host of this.hosts.values()) {
      host.hostLocalPos.copy(host.hostAbsPos).sub(this.worldOffset);
      this.writeHostLocalPos(host);
    }
    this.flushHostLocalPosAttributes();
  }

  /**
   * Recompute per-host cull distances when the magnitude slider
   * moves. Stellata.ts calls this from `setFilter` whenever
   * `maxAppMag` changes.
   */
  setMaxAppMag(maxAppMag: number): void {
    if (this.maxAppMag === maxAppMag) return;
    this.maxAppMag = maxAppMag;
    for (const host of this.hosts.values()) {
      host.cullDistance = cullDistancePc(host.hostAbsmag, host.brightestReflectance, maxAppMag);
    }
  }

  /** Current magnitude-slider cutoff — the sensitivity the mesh
   *  layer's lit-surface exposure tracks. */
  getMaxAppMag(): number {
    return this.maxAppMag;
  }

  /**
   * Per-frame ephemeris refresh + buffer upload. For each attached
   * host, skip the work entirely when the camera is past `cullDistance`
   * — the planets would be sub-cutoff anyway and stale iLocalRel data
   * is harmless once the host comes back into range.
   *
   * `nowMs` is wall-clock (performance.now()) for the eclipse-dim
   * anti-strobe filter — a render filter, not sim time.
   */
  update(camera: THREE.PerspectiveCamera, t: number, nowMs: number): void {
    if (this.liveCount === 0) {
      this.group.visible = false;
      return;
    }
    // Rendering is gated by hidden; the ephemeris walk is
    // NOT. The focal-frame ride and observe anchor read live planet
    // positions (bufLocalRel) off this walk even when the bodies aren't
    // drawn — chart mode observes from a planet, so freezing the walk
    // there strands the anchor's orbital motion. Only the GPU upload is
    // skipped while invisible (the CPU buffer still advances).
    const render = !this.hidden;
    this.group.visible = render;
    let touched = false;
    for (const host of this.hosts.values()) {
      const dToHost = camera.position.distanceTo(host.hostLocalPos);
      if (dToHost > host.cullDistance) continue;
      if (host.positionsAt) {
        this.writeHostPositions(host, t);
        touched = true;
      }
      this.collectEclipseDimTargets(host, camera.position);
    }
    if (touched && render) this.flushDynamicAttributes();

    const blend = dimBlendFactor(nowMs, this.lastDimNowMs, ECLIPSE_DIM_TAU_S);
    this.lastDimNowMs = nowMs;
    if (blendDimBuffer(this.bufs.eclipseDim, this.dimTargets, this.dimActive, blend)) {
      (this.geometry.attributes.iEclipseDim as THREE.InstancedBufferAttribute)
        .needsUpdate = true;
    }
    this.dimTargets.clear();
  }

  /** True-eclipse targets for one host's planets: a planet whose disc
   *  crosses BEHIND the host's physical disc dims by the occluded area
   *  fraction (`eclipseDimFromOffsets`, the binaries eclipse-photometry
   *  math). Glow through the host's perceptual halo is physically
   *  correct and stays undimmed; a planet in FRONT (transit) dims the
   *  host by (R_p/R_host)² — negligible, and the host is a star-pipeline
   *  instance this field doesn't own. The pair-relative offset is
   *  iLocalRel itself (small values, not a large-position difference),
   *  so float32 carries it fine.
   *
   *  A moon additionally dims by its parent's shadow — the same lens
   *  math evaluated from the MOON's viewpoint (primary = host, secondary
   *  = parent planet): the visible fraction of the host disc IS the
   *  moon's illumination factor, so a lunar-style eclipse darkens the
   *  moon continuously through the penumbra. The two dims compose
   *  multiplicatively (independent light losses). */
  private collectEclipseDimTargets(
    host: AttachedHost,
    cameraPos: Readonly<THREE.Vector3>,
  ): void {
    const losX = host.hostLocalPos.x - cameraPos.x;
    const losY = host.hostLocalPos.y - cameraPos.y;
    const losZ = host.hostLocalPos.z - cameraPos.z;
    const family = systemFamily(host.ps.planets);
    for (let i = 0; i < host.count; i++) {
      const idx = host.startInstance + i;
      const base = idx * 3;
      let dim = 1;
      const result = eclipseDimFromOffsets(
        losX, losY, losZ,
        this.bufs.localRel[base + 0],
        this.bufs.localRel[base + 1],
        this.bufs.localRel[base + 2],
        host.hostRadiusPc,
        this.bufs.radius[idx],
      );
      if (result.front === 'primary' && result.dim < 1) {
        dim = result.dim;
      }
      const parentIdx = family.parentIdx[i];
      if (parentIdx >= 0) {
        const pBase = (host.startInstance + parentIdx) * 3;
        const shadow = eclipseDimFromOffsets(
          -this.bufs.localRel[base + 0],
          -this.bufs.localRel[base + 1],
          -this.bufs.localRel[base + 2],
          this.bufs.localRel[pBase + 0],
          this.bufs.localRel[pBase + 1],
          this.bufs.localRel[pBase + 2],
          host.hostRadiusPc,
          this.bufs.radius[host.startInstance + parentIdx],
        );
        if (shadow.front === 'secondary' && shadow.dim < 1) {
          dim *= shadow.dim;
        }
      }
      if (dim < 1) this.dimTargets.set(idx, dim);
    }
  }

  /** Current eclipse-dim slot for a flat instance (1 = undimmed). */
  eclipseDimForInstance(instanceIdx: number): number {
    return instanceIdx >= 0 && instanceIdx < this.liveCount
      ? this.bufs.eclipseDim[instanceIdx]
      : 1;
  }

  /**
   * Fresh-copy snapshot of a host's planet positions RELATIVE TO THE
   * HOST (the shader's iLocalRel — renderer-local only after adding
   * `getHostLocalPositionInto`). Layout: 3 floats per planet, ordering
   * matches PlanetSystem.planets. Returns null when the host isn't
   * attached.
   *
   * The planet-labels overlay reads this (host offset re-added by
   * `Stellata.getFocusedPlanetLocalPositions`) so labels project to
   * the same positions the body shader renders at, without re-running
   * the Keplerian math itself.
   *
   * Returns a Float32Array `.slice()` (copy), not a `.subarray()`
   * view — the copy survives attach-driven capacity grow and
   * detach-driven tail-shift, so callers can hold a cached reference
   * without silently reading stale data the next frame. The allocation
   * cost is ~3·count·4 bytes per call (108 B at Sol scale), dwarfed by
   * the projection math that follows.
   */
  getHostLocalPositions(hostStarIdx: number): Float32Array | null {
    const host = this.hosts.get(hostStarIdx);
    if (!host) return null;
    return this.bufs.localRel.slice(
      host.startInstance * 3,
      (host.startInstance + host.count) * 3,
    );
  }

  /**
   * Host star's renderer-local position into `out` — the same
   * hostLocalPos the planet shader adds to iLocalRel, so any layer
   * anchored on it (orbit rings, labels) stays centred on the exact
   * point the bodies orbit. Under planet focus the floating origin
   * sits on the planet, so this is NOT the local origin. Returns
   * false when the host isn't attached.
   */
  getHostLocalPositionInto(hostStarIdx: number, out: THREE.Vector3): boolean {
    const host = this.hosts.get(hostStarIdx);
    if (!host) return false;
    out.copy(host.hostLocalPos);
    return true;
  }


  /**
   * Per-instance apparent V mag for one of the host's planets, evaluated
   * from `cameraPosLocal` (in the renderer's local frame). Mirrors the
   * planet vertex shader's reflected-light formula exactly via
   * `planetApparentMagnitude` in perceptual-magnitude.ts (vitest-pinned)
   * and the matching per-planet phase factor in phase-function.ts.
   *
   * Returns null if the host isn't attached or planetIdx is out of
   * range. Callers should treat null the same way the shader treats
   * `appMag > uMaxAppMag + 0.5` — the planet isn't a viable hover target.
   */
  appMagFor(
    hostStarIdx: number,
    planetIdx: number,
    cameraPosLocal: Readonly<THREE.Vector3>,
  ): number | null {
    const host = this.hosts.get(hostStarIdx);
    if (!host) return null;
    if (planetIdx < 0 || planetIdx >= host.count) return null;
    return this.evalPlanetView(host, planetIdx, cameraPosLocal).appMag;
  }

  /**
   * Geometry-and-photometry of one of the host's planets evaluated from
   * a single viewer position in the local frame. Mirrors the planet
   * vertex shader's reflected-light pipeline (phase factor → apparent
   * magnitude) and produces the world-space planet position the picker
   * projects to screen — single source for the math that both
   * `appMagFor` (hover formatter feed) and `pick` (hover picker)
   * consume, so the two can't drift on phase / albedo / radius logic.
   *
   * No null branch: caller has already checked the host attached state
   * and the planetIdx range.
   */
  private evalPlanetView(
    host: AttachedHost,
    planetIdx: number,
    cameraPosLocal: Readonly<THREE.Vector3>,
  ): { appMag: number; planetX: number; planetY: number; planetZ: number; dVp: number } {
    const planet = host.ps.planets[planetIdx];
    const base = (host.startInstance + planetIdx) * 3;
    const planetX = host.hostLocalPos.x + this.bufs.localRel[base + 0];
    const planetY = host.hostLocalPos.y + this.bufs.localRel[base + 1];
    const planetZ = host.hostLocalPos.z + this.bufs.localRel[base + 2];
    const dvx = planetX - cameraPosLocal.x;
    const dvy = planetY - cameraPosLocal.y;
    const dvz = planetZ - cameraPosLocal.z;
    const dVp = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz);
    const dhx = host.hostLocalPos.x - cameraPosLocal.x;
    const dhy = host.hostLocalPos.y - cameraPosLocal.y;
    const dhz = host.hostLocalPos.z - cameraPosLocal.z;
    // Planet→host distance is just the iLocalRel magnitude.
    const dHp = Math.sqrt(
      this.bufs.localRel[base + 0] ** 2 +
        this.bufs.localRel[base + 1] ** 2 +
        this.bufs.localRel[base + 2] ** 2,
    );
    const phi = phaseFactorFor(dvx, dvy, dvz, dhx, dhy, dhz, planet.phaseCoefficients);
    const radiusPc = planet.radiusKm * KM_PC;
    const appMag = planetApparentMagnitude(
      host.hostAbsmag,
      dVp,
      dHp,
      planet.albedo,
      radiusPc,
      phi,
    );
    return { appMag, planetX, planetY, planetZ, dVp };
  }

  /** Read-only handle to the PlanetSystem the field has cached for a
   *  given host, or null if the host isn't attached. The hover formatter
   *  uses this to look up `planets[]` for the winning host without
   *  forcing the engine / Stellata to re-resolve via async
   *  `getPlanetSystem`. */
  getAttachedPlanetSystem(hostStarIdx: number): PlanetSystem | null {
    const host = this.hosts.get(hostStarIdx);
    return host ? host.ps : null;
  }

  // ── flat-instance identity (Target {kind:'planet'} currency) ────────
  //
  // A planet FocusTarget's idx is the flat global instance index. The
  // accessors below are the attach-table resolution both directions.
  // Flat indices are NOT stable across detach compaction — resolve per
  // use, never cache one across an attach/detach cycle.

  /** Live flat-instance count (mesh-LOD layer iteration bound). */
  get liveInstanceCount(): number {
    return this.liveCount;
  }

  /** Flat instance currently hidden via setHiddenInstance (-1 = none)
   *  — the observe-anchor body; the mesh LOD must hide it too. */
  get hiddenInstanceIdx(): number {
    return this.hideIdxUniform.value;
  }

  /** Host's ICRS orbital-plane orientation, or null when unattached. */
  hostOrientationOf(hostStarIdx: number): THREE.Quaternion | null {
    return this.hosts.get(hostStarIdx)?.orientation ?? null;
  }

  /** Host star's physical radius (pc), or null when unattached — the
   *  light source's disc for shadow penumbra and eclipse dims. */
  hostRadiusOf(hostStarIdx: number): number | null {
    return this.hosts.get(hostStarIdx)?.hostRadiusPc ?? null;
  }

  /** (host, planet-within-host) for a flat instance index, or null when
   *  no attached host covers it. */
  hostPlanetOf(instanceIdx: number): { hostStarIdx: number; planetIdx: number } | null {
    const host = this.hostOfInstance(instanceIdx);
    if (!host) return null;
    return { hostStarIdx: host.hostStarIdx, planetIdx: instanceIdx - host.startInstance };
  }

  /** Flat instance index for (host, planet-within-host), or null when
   *  the host isn't attached or the index is out of range. */
  instanceIndexOf(hostStarIdx: number, planetIdx: number): number | null {
    const host = this.hosts.get(hostStarIdx);
    if (!host || planetIdx < 0 || planetIdx >= host.count) return null;
    return host.startInstance + planetIdx;
  }

  /** Planet record for a flat instance index, or null. */
  planetAt(instanceIdx: number): Planet | null {
    const host = this.hostOfInstance(instanceIdx);
    return host ? host.ps.planets[instanceIdx - host.startInstance] : null;
  }

  /** Host-relative offset (the shader's iLocalRel — orientation-applied
   *  orbital offset without the host position) into `out`. The orbit-
   *  ring layer anchors a moon's parent-centred ring on it. */
  planetHostRelPositionInto(instanceIdx: number, out: THREE.Vector3): boolean {
    const host = this.hostOfInstance(instanceIdx);
    if (!host) return false;
    const base = instanceIdx * 3;
    out.set(
      this.bufs.localRel[base + 0],
      this.bufs.localRel[base + 1],
      this.bufs.localRel[base + 2],
    );
    return true;
  }

  /** Renderer-local position (host local + orientation-applied orbital
   *  offset — exactly what the shader renders) into `out`. */
  planetLocalPositionInto(instanceIdx: number, out: THREE.Vector3): boolean {
    const host = this.hostOfInstance(instanceIdx);
    if (!host) return false;
    const base = instanceIdx * 3;
    out.set(
      host.hostLocalPos.x + this.bufs.localRel[base + 0],
      host.hostLocalPos.y + this.bufs.localRel[base + 1],
      host.hostLocalPos.z + this.bufs.localRel[base + 2],
    );
    return true;
  }

  /** Absolute (catalog-space) position into `out` — the recenterOrigin
   *  anchor when a planet is focused. */
  planetAbsolutePositionInto(instanceIdx: number, out: THREE.Vector3): boolean {
    const host = this.hostOfInstance(instanceIdx);
    if (!host) return false;
    const base = instanceIdx * 3;
    out.set(
      host.hostAbsPos.x + this.bufs.localRel[base + 0],
      host.hostAbsPos.y + this.bufs.localRel[base + 1],
      host.hostAbsPos.z + this.bufs.localRel[base + 2],
    );
    return true;
  }

  /** Apparent V mag for a flat instance from `cameraPosLocal` — the
   *  instance-keyed sibling of `appMagFor`. */
  appMagForInstance(
    instanceIdx: number,
    cameraPosLocal: Readonly<THREE.Vector3>,
  ): number | null {
    const host = this.hostOfInstance(instanceIdx);
    if (!host) return null;
    return this.evalPlanetView(host, instanceIdx - host.startInstance, cameraPosLocal).appMag;
  }

  /** Rendered disc diameter in px at `cameraPosLocal` — the CPU mirror
   *  of the shader's `max(appSize, physSize)`, shared with `pick`.
   *  0 when the instance is unattached or below the soft-taper kill. */
  renderedPlanetSizePx(instanceIdx: number, cameraPosLocal: Readonly<THREE.Vector3>): number {
    const host = this.hostOfInstance(instanceIdx);
    if (!host) return 0;
    const i = instanceIdx - host.startInstance;
    const { appMag, dVp } = this.evalPlanetView(host, i, cameraPosLocal);
    if (dVp <= 0 || appMag > this.magShared.uMaxAppMag.value + SOFT_TAPER_MARGIN_MAG) return 0;
    return this.discPixelSize(host.ps.planets[i].radiusKm * KM_PC, dVp, appMag);
  }

  /** Physical (true angular-diameter) disc size in px, excluding the
   *  perceptual brightness floor that keeps faint bodies visible as dots —
   *  the "is this a resolved body?" measure driving the mesh LOD's
   *  presence band. 0 when unattached, degenerate, or below the
   *  soft-taper kill (mesh and billboard die together). */
  physicalPlanetSizePx(instanceIdx: number, cameraPosLocal: Readonly<THREE.Vector3>): number {
    const host = this.hostOfInstance(instanceIdx);
    if (!host) return 0;
    const i = instanceIdx - host.startInstance;
    const { appMag, dVp } = this.evalPlanetView(host, i, cameraPosLocal);
    if (dVp <= 0 || appMag > this.magShared.uMaxAppMag.value + SOFT_TAPER_MARGIN_MAG) return 0;
    return this.discSizeTerms(host.ps.planets[i].radiusKm * KM_PC, dVp, appMag).physSize;
  }

  /** True when the body currently renders as one on-screen point with
   *  its parent (host star for a planet, parent body for a moon):
   *  drawn this frame — past the same cutoff the shader applies — AND
   *  angular separation from the parent below
   *  BODY_COLLAPSE_THRESHOLD_PX. Collapsed bodies drop out of `pick`
   *  (the parent's own pick surface owns the point) and drive the
   *  planet system-membership provider's clusters. */
  isCollapsedOntoParent(instanceIdx: number, camera: THREE.PerspectiveCamera): boolean {
    const host = this.hostOfInstance(instanceIdx);
    if (!host || this.hidden) return false;
    const i = instanceIdx - host.startInstance;
    const camPos = camera.position;
    const { appMag, planetX, planetY, planetZ, dVp } = this.evalPlanetView(host, i, camPos);
    const cutoff = this.magShared.uMaxAppMag.value + (this.mono ? 0 : SOFT_TAPER_MARGIN_MAG);
    if (dVp <= 0 || appMag > cutoff) return false;

    const planet = host.ps.planets[i];
    const pi = planet.parentName ? parentIndexOf(host.ps.planets, planet.parentName) : -1;
    let px = host.hostLocalPos.x;
    let py = host.hostLocalPos.y;
    let pz = host.hostLocalPos.z;
    if (pi >= 0) {
      const base = (host.startInstance + pi) * 3;
      px += this.bufs.localRel[base + 0];
      py += this.bufs.localRel[base + 1];
      pz += this.bufs.localRel[base + 2];
    }

    const ux = planetX - camPos.x;
    const uy = planetY - camPos.y;
    const uz = planetZ - camPos.z;
    const vx = px - camPos.x;
    const vy = py - camPos.y;
    const vz = pz - camPos.z;
    // Camera exactly at the parent (observe mode parks there): the
    // parent has no screen point to collapse onto.
    if (vx * vx + vy * vy + vz * vz === 0) return false;
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const angle = Math.atan2(Math.sqrt(cx * cx + cy * cy + cz * cz), ux * vx + uy * vy + uz * vz);
    const pxPerRad = this.magShared.uViewport.value.y / this.magShared.uFovYRad.value;
    return angle * pxPerRad < BODY_COLLAPSE_THRESHOLD_PX;
  }

  private hostOfInstance(instanceIdx: number): AttachedHost | null {
    if (instanceIdx < 0 || instanceIdx >= this.liveCount) return null;
    const hostStarIdx = this.instanceHost[instanceIdx];
    return hostStarIdx < 0 ? null : this.hosts.get(hostStarIdx) ?? null;
  }

  /** Rebuild the flat-instance → hostStarIdx reverse index from the
   *  attach table. Called after every attach/detach. */
  private rebuildInstanceMap(): void {
    this.instanceHost.fill(-1);
    for (const host of this.hosts.values()) {
      for (let i = 0; i < host.count; i++) {
        this.instanceHost[host.startInstance + i] = host.hostStarIdx;
      }
    }
  }

  /** Shader-mirroring physical + perceptual disc sizes in CSS px,
   *  reading the live shared uniforms so debug-panel writes stay in
   *  lockstep. */
  private discSizeTerms(
    radiusPc: number,
    dVp: number,
    appMag: number,
  ): { physSize: number; appSize: number } {
    const viewportH = this.magShared.uViewport.value.y;
    const fovYRad = this.magShared.uFovYRad.value;
    const physSize = physSizePx(radiusPc, dVp, viewportH, fovYRad);
    const dMEff = perceptualDmEff(
      appMag,
      this.magShared.uMaxAppMag.value,
      this.magShared.uSizeSpan.value,
      this.magShared.uSizeKnee.value,
    );
    const appSize = perceptualAppSizePx(
      dMEff,
      this.magShared.uSizeMin.value,
      this.magShared.uSizeMax.value,
      this.magShared.uSizeSpan.value,
    );
    return { physSize, appSize };
  }

  private discPixelSize(radiusPc: number, dVp: number, appMag: number): number {
    // Chart mode mirrors the vertex shader's chart branch — flat
    // magnitude-driven disc, no physical/perceptual terms.
    if (this.mono) {
      return chartDiscPxForAppMag(
        appMag,
        {
          maxPx: this.magShared.uChartDiscMaxPx.value,
          minPx: this.magShared.uChartDiscMinPx.value,
          magBright: this.magShared.uChartMagBright.value,
        },
        this.magShared.uMaxAppMag.value,
      );
    }
    const { physSize, appSize } = this.discSizeTerms(radiusPc, dVp, appMag);
    return Math.max(appSize, physSize);
  }

  /**
   * Hover-engine pick path for the planet layer. Walks
   * EVERY attached host's planets — the rule per
   * the hover conventions is "visibility ⇒ hoverable", so
   * focus state plays no part in the gate. v1 only attaches Sol, so the
   * loop has one host to traverse; bk5 will iterate any registered
   * exoplanet host that has live `iLocalRel` data.
   *
   * Each candidate projects to screen, classifies prime (cursor inside
   * the rendered disc) vs fallback (cursor near the projected centre
   * within `pxThreshold`), and is reduced by the closest-cursor scorer.
   * The winner's `hostStarIdx` rides in the returned `HoverHit` so the
   * formatter can resolve `(hostStarIdx, planetIdx)` back to a Planet
   * record without re-walking the hosts.
   *
   * Disc sizing mirrors the planet vertex shader's
   * `pxSize = max(appSize, physSize)` exactly via the shared
   * perceptual + angular-diameter helpers. Planets whose appMag exceeds
   * the soft-taper cutoff are skipped — the GPU emits no quad, so hover
   * can't pick what isn't drawn. The whole field is unpickable when it
   * isn't rendered at all (chart mode hides the bodies; `setHidden`), so
   * click-pick matches render visibility exactly, like the star pick.
   */
  pick(
    camera: THREE.PerspectiveCamera,
    rect: DOMRect,
    clientX: number,
    clientY: number,
    pxThreshold: number,
  ): HoverHit | null {
    if (this.hosts.size === 0 || this.hidden) return null;
    const cursorX = clientX - rect.left;
    const cursorY = clientY - rect.top;
    const viewportW = rect.width;
    const viewportH = rect.height;
    const maxAppMag = this.magShared.uMaxAppMag.value;
    const camPos = camera.position;

    // Walk every host × planet and collect candidates that qualify for
    // either tier. Cross-host reduction is delegated to the shared
    // `pickFromCandidates` (closest-cursor wins within tier, prime
    // beats fallback) — same reducer the star and Local Group pickers
    // use, so the cross-layer disambiguator above sees consistent tier
    // semantics from every layer. The candidate carries its
    // `hostStarIdx` + `cameraDistancePc` straight through to the
    // returned HoverHit; no post-reduce re-projection.
    const candidates: CrossHostCandidate[] = [];
    const v = new THREE.Vector3();
    for (const host of this.hosts.values()) {
      for (let i = 0; i < host.count; i++) {
        const { appMag, planetX, planetY, planetZ, dVp } =
          this.evalPlanetView(host, i, camPos);
        if (dVp <= 0) continue;
        // Same kill condition as the planet vertex shader: past the
        // cutoff the GPU emits no quad and the hover can't pick what
        // isn't drawn. Chart mode hard-clips (no soft taper) — same
        // rule Picker.pickStar applies there.
        const cutoff = maxAppMag + (this.mono ? 0 : SOFT_TAPER_MARGIN_MAG);
        if (appMag > cutoff) continue;
        // A body collapsed onto its parent renders as one point with
        // it — that point's pick belongs to the parent (the star
        // picker for a host, the parent planet's own candidacy for a
        // moon), so the member is not individually pickable.
        if (this.isCollapsedOntoParent(host.startInstance + i, camera)) continue;

        v.set(planetX, planetY, planetZ);
        const screen = projectToScreen(v, camera, viewportW, viewportH);
        if (!screen) continue;
        const pxDist = Math.hypot(cursorX - screen[0], cursorY - screen[1]);

        const radiusPc = host.ps.planets[i].radiusKm * KM_PC;
        const pxSize = this.discPixelSize(radiusPc, dVp, appMag);
        const hitRadius = Math.max(pxSize * 0.5, MIN_DISC_HIT_RADIUS_PX);

        if (pxDist > hitRadius && pxDist > pxThreshold) continue;
        candidates.push({
          idx: i,
          pxDist,
          hitRadius,
          hostStarIdx: host.hostStarIdx,
          cameraDistancePc: dVp,
        });
      }
    }

    const winner = pickFromCandidates(candidates, pxThreshold);
    if (winner === null) return null;
    return {
      idx: winner.candidate.idx,
      hostStarIdx: winner.candidate.hostStarIdx,
      cameraDistancePc: winner.candidate.cameraDistancePc,
      tier: winner.tier,
    };
  }

  /** Local-depth-pass mirror draws (disc + glow over the active
   *  cluster's slot range). The solar-system cluster parents this into
   *  the pass scene; it renders nothing while no range is set. */
  get localGroup(): THREE.Group {
    return this.localMirrorGroup;
  }

  /** Set (or clear, with (-1, 0)) the active cluster's slot range.
   *  Instances inside the range collapse in the main pass and render
   *  via the mirror draws in the local depth pass instead. */
  setLocalPassRange(start: number, count: number): void {
    const v = this.localPassRangeUniform.value;
    v[0] = start;
    v[1] = count;
  }

  /** Attach-table view for the solar-system cluster: slot range +
   *  live host geometry per attached host. */
  attachedHosts(): IterableIterator<{
    hostStarIdx: number;
    startInstance: number;
    count: number;
    hostLocalPos: Readonly<THREE.Vector3>;
    hostRadiusPc: number;
    cullDistance: number;
    ps: PlanetSystem;
  }> {
    return this.hosts.values();
  }

  /** Chart mode renders the bodies as flat ink discs, star-identical:
   *  the shared uMonochrome uniform flips the shader branches; here we
   *  only swap the blending the same way the star pipeline's
   *  setMonochromeBlend does. Rings stay hidden (their own layer);
   *  the mesh LOD hides via `monochrome` below. */
  setMonochrome(on: boolean): void {
    this.mono = on;
    if (on) {
      this.matDisc.blending = THREE.MultiplyBlending;
      this.matDisc.depthWrite = false;
      this.matDisc.depthTest = false;
      this.matGlow.blending = THREE.MultiplyBlending;
      this.matGlow.depthTest = false;
    } else {
      applyDiscBlendDefaults(this.matDisc);
      applyGlowBlendDefaults(this.matGlow);
    }
    this.matDisc.needsUpdate = true;
    this.matGlow.needsUpdate = true;
    this.group.visible = !this.hidden && this.liveCount > 0;
  }

  get monochrome(): boolean {
    return this.mono;
  }

  setHidden(on: boolean): void {
    this.hidden = on;
    if (on) this.group.visible = false;
    else this.group.visible = this.liveCount > 0;
  }

  /** Hide one body by flat instance index (-1 = none) — the planet
   *  sibling of the star pipeline's uHideFocusIdx, consumed by observe
   *  mode for the body the camera is parked at. All five passes share
   *  the uniform, so the hidden body writes no colour and no depth. */
  setHiddenInstance(instanceIdx: number): void {
    this.hideIdxUniform.value = instanceIdx;
  }

  hiddenInstance(): number {
    return this.hideIdxUniform.value;
  }

  dispose(): void {
    this.geometry.dispose();
    this.matDisc.dispose();
    this.matGlow.dispose();
    this.matCore.dispose();
    this.matDiscLocal.dispose();
    this.matGlowLocal.dispose();
  }

  // ── private ─────────────────────────────────────────────────────────

  private allocateBuffers(capacity: number): void {
    const bufs = {} as Record<InstanceBufKey, Float32Array>;
    for (const [key, spec] of SPEC_ENTRIES) {
      bufs[key] = new Float32Array(capacity * spec.dims);
      if (spec.fill !== undefined) bufs[key].fill(spec.fill);
    }
    this.bufs = bufs;
    this.instanceHost = new Int32Array(capacity).fill(-1);
  }

  private growCapacity(): void {
    const oldBufs = this.bufs;
    this.allocateBuffers(this.capacity * 2);
    for (const [key] of SPEC_ENTRIES) {
      this.bufs[key].set(oldBufs[key]);
    }
    this.capacity *= 2;
    // Replace the geometry with a fresh one over the new buffers.
    // Materials and meshes are re-bound via three.js's normal
    // geometry-swap path.
    const oldGeom = this.geometry;
    this.buildGeometry();
    this.meshDisc.geometry = this.geometry;
    this.meshGlow.geometry = this.geometry;
    this.meshCore.geometry = this.geometry;
    this.meshDiscLocal.geometry = this.geometry;
    this.meshGlowLocal.geometry = this.geometry;
    oldGeom.dispose();
  }

  private buildGeometry(): void {
    const geom = new THREE.InstancedBufferGeometry();
    geom.setAttribute(
      'aCorner',
      new THREE.BufferAttribute(
        new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]),
        2,
      ),
    );
    geom.setIndex([0, 1, 2, 1, 3, 2]);
    for (const [key, spec] of SPEC_ENTRIES) {
      const attr = new THREE.InstancedBufferAttribute(this.bufs[key], spec.dims);
      if (spec.dynamicUsage) attr.setUsage(THREE.DynamicDrawUsage);
      geom.setAttribute(spec.attr, attr);
    }
    geom.instanceCount = this.liveCount;
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geometry = geom;
  }

  private buildMaterials(sm: PerceptualDiscUniforms & ChartDiscUniforms): void {
    const sharedPlanetUniforms = {
      ...pickPerceptualDiscUniforms(sm),
      ...pickChartDiscUniforms(sm),
    };

    const makeMat = (
      mode: number,
      params: THREE.ShaderMaterialParameters,
      localPass = false,
    ) =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: planetVert,
        fragmentShader: planetFrag,
        ...(localPass ? { defines: { LOCAL_DEPTH_PASS: '' } } : {}),
        uniforms: {
          ...sharedPlanetUniforms,
          uRenderMode: { value: mode },
          uHideIdx: this.hideIdxUniform,
          uLocalPassRange: this.localPassRangeUniform,
          uDiscFadeRatio: {
            value: new THREE.Vector2(DISC_FADE_START_RATIO, DISC_FADE_END_RATIO),
          },
        },
        ...params,
      });

    this.matDisc = makeMat(1, { transparent: true });
    applyDiscBlendDefaults(this.matDisc);

    this.matGlow = makeMat(0, {});
    applyGlowBlendDefaults(this.matGlow);

    this.matCore = makeMat(2, {
      depthWrite: true,
      depthTest: true,
      colorWrite: false,
    });

    this.matDiscLocal = makeMat(1, { transparent: true }, true);
    applyDiscBlendDefaults(this.matDiscLocal);
    this.matGlowLocal = makeMat(0, {}, true);
    applyGlowBlendDefaults(this.matGlowLocal);

    const makeMesh = (mat: THREE.ShaderMaterial, name: string, order: number) => {
      const m = new THREE.Mesh(this.geometry, mat);
      m.name = name;
      m.frustumCulled = false;
      m.renderOrder = order;
      return m;
    };

    this.meshCore = makeMesh(this.matCore, 'core', -4);
    this.meshDisc = makeMesh(this.matDisc, 'disc', 3);
    this.meshGlow = makeMesh(this.matGlow, 'glow', 4);

    this.group.add(this.meshCore);
    this.group.add(this.meshDisc);
    this.group.add(this.meshGlow);

    // Local-pass mirrors: same geometry, member-range-gated. Disc at 3
    // (after the mesh LOD at 2.8/2.81, so the fading disc composites
    // over the mesh exactly as it did in the main pass); glow last at
    // 4 so a transiting body's glow adds over everything — including a
    // parent mesh behind it. No core mask: the local pass has no
    // background layers to pre-fail.
    this.meshDiscLocal = makeMesh(this.matDiscLocal, 'disc-local', 3);
    this.meshGlowLocal = makeMesh(this.matGlowLocal, 'glow-local', 4);
    this.localMirrorGroup.add(this.meshDiscLocal);
    this.localMirrorGroup.add(this.meshGlowLocal);
  }

  /** One-shot fill of static per-instance attributes (radius, colour,
   *  solidity, albedo, host absmag, phase coefficients) for a
   *  freshly-attached host. */
  private writeHostStaticAttributes(host: AttachedHost): void {
    const baseScalar = host.startInstance;
    const baseVec3 = host.startInstance * 3;
    const baseVec4 = host.startInstance * 4;
    for (let i = 0; i < host.count; i++) {
      const planet = host.ps.planets[i];
      this.bufs.radius[baseScalar + i] = planet.radiusKm * KM_PC;
      this.bufs.colour[baseVec3 + i * 3 + 0] = planet.colour[0];
      this.bufs.colour[baseVec3 + i * 3 + 1] = planet.colour[1];
      this.bufs.colour[baseVec3 + i * 3 + 2] = planet.colour[2];
      this.bufs.solidity[baseScalar + i] = solidityForType(planet.type);
      this.bufs.albedo[baseScalar + i] = planet.albedo;
      this.bufs.hostAbsmag[baseScalar + i] = host.hostAbsmag;
      // Phase coefficients packed (c0,c1,c2,c3) | (c4,c5,c6,alphaMaxDeg)
      // | (c7,_,_,_). Bodies without published curves write all zeros —
      // alphaMaxDeg=0 is the shader's "use Lambertian" sentinel.
      const pc = planet.phaseCoefficients;
      const phaseOff = baseVec4 + i * 4;
      this.bufs.phaseA[phaseOff + 0] = pc ? pc.c0 : 0;
      this.bufs.phaseA[phaseOff + 1] = pc ? pc.c1 : 0;
      this.bufs.phaseA[phaseOff + 2] = pc ? pc.c2 : 0;
      this.bufs.phaseA[phaseOff + 3] = pc ? pc.c3 : 0;
      this.bufs.phaseB[phaseOff + 0] = pc ? pc.c4 : 0;
      this.bufs.phaseB[phaseOff + 1] = pc ? pc.c5 : 0;
      this.bufs.phaseB[phaseOff + 2] = pc ? pc.c6 : 0;
      this.bufs.phaseB[phaseOff + 3] = pc ? pc.alphaMaxDeg : 0;
      this.bufs.phaseC[phaseOff + 0] = pc ? pc.c7 : 0;
      this.bufs.phaseC[phaseOff + 1] = 0;
      this.bufs.phaseC[phaseOff + 2] = 0;
      this.bufs.phaseC[phaseOff + 3] = 0;
    }
    this.writeHostLocalPos(host);
  }

  /** Write the host's renderer-local position into the iHostLocalPos
   *  slots of all of its planet instances. */
  private writeHostLocalPos(host: AttachedHost): void {
    const base = host.startInstance * 3;
    const x = host.hostLocalPos.x;
    const y = host.hostLocalPos.y;
    const z = host.hostLocalPos.z;
    for (let i = 0; i < host.count; i++) {
      this.bufs.hostLocalPos[base + i * 3 + 0] = x;
      this.bufs.hostLocalPos[base + i * 3 + 1] = y;
      this.bufs.hostLocalPos[base + i * 3 + 2] = z;
    }
  }

  /** Resolve planet positions at time `t` and write them to the
   *  host's iLocalRel slots. Uses the host's positionsAt resolver
   *  when present (Sol via JPL Standish), else the placeholder
   *  eccentric-anomaly layout. */
  private writeHostPositions(host: AttachedHost, t: number): void {
    const base = host.startInstance * 3;
    if (host.positionsAt && host.positionsScratch) {
      host.positionsAt(t, host.positionsScratch);
      this.rotateInto(
        host.positionsScratch,
        this.bufs.localRel,
        base,
        host.orientation,
      );
    } else {
      const tmp = this.rotateTmp;
      for (let i = 0; i < host.count; i++) {
        const p = host.ps.planets[i];
        const ea = placeholderEccentricAnomaly(i, host.count);
        planetLocalPosition(p.semiMajorAxisAu, p.eccentricity, ea, host.orientation, tmp);
        this.bufs.localRel[base + i * 3 + 0] = tmp.x;
        this.bufs.localRel[base + i * 3 + 1] = tmp.y;
        this.bufs.localRel[base + i * 3 + 2] = tmp.z;
      }
    }
  }

  /** Rotate a flat plane-frame xyz buffer into ICRS-aligned local frame
   *  and write it at `dstStart` in `dst`. */
  private rotateInto(
    src: Float32Array,
    dst: Float32Array,
    dstStart: number,
    orientation: THREE.Quaternion,
  ): void {
    const tmp = this.rotateTmp;
    const n = src.length;
    for (let i = 0; i < n; i += 3) {
      tmp.set(src[i], src[i + 1], src[i + 2]);
      tmp.applyQuaternion(orientation);
      dst[dstStart + i + 0] = tmp.x;
      dst[dstStart + i + 1] = tmp.y;
      dst[dstStart + i + 2] = tmp.z;
    }
  }

  /** Per-frame: only iLocalRel changes in `update()` (the planet
   *  positions tick; host position, radius, colour, phase coefficients
   *  are static for the host's lifetime). At bk5 scale (hundreds of
   *  hosts × thousands of planets) flagging only the one dirty buffer
   *  matters — the others would re-upload static data every frame
   *  otherwise. */
  private flushDynamicAttributes(): void {
    if (!this.geometry) return;
    (this.geometry.attributes.iLocalRel as THREE.InstancedBufferAttribute)
      .needsUpdate = true;
  }

  /** Recenter path: only iHostLocalPos changes (each host's local
   *  offset is recomputed against the new floating-origin). */
  private flushHostLocalPosAttributes(): void {
    if (!this.geometry) return;
    (this.geometry.attributes.iHostLocalPos as THREE.InstancedBufferAttribute)
      .needsUpdate = true;
  }

  /** Attach / detach / grow: every per-instance attribute could be
   *  dirty (the host's slot was just written; or a tail-shift moved
   *  every other host's data). */
  private flushAllAttributes(): void {
    if (!this.geometry) return;
    for (const [, spec] of SPEC_ENTRIES) {
      (this.geometry.attributes[spec.attr] as THREE.InstancedBufferAttribute)
        .needsUpdate = true;
    }
  }

  /** Compact-down step used by detachHost(). Shifts a contiguous tail
   *  range backwards by `gap` slots in every per-instance buffer. */
  private shiftInstancesDown(tailStart: number, tailCount: number, gap: number): void {
    for (const [key, spec] of SPEC_ENTRIES) {
      const tailBase = tailStart * spec.dims;
      const tailEnd = tailBase + tailCount * spec.dims;
      this.bufs[key].copyWithin(tailBase - gap * spec.dims, tailBase, tailEnd);
    }
  }
}

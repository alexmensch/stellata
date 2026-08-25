// Instanced fixed-size marker per deep-space probe, positioned from the
// trajectory sampler each frame. See README.md § Marker field.

import * as THREE from 'three';
import { HELIOPAUSE_EXTENT_PC } from '../heliopause/heliopause';
import type { PerceptualDiscUniforms } from '../../star-pipeline/perceptual-disc/perceptual-disc-uniforms';
import {
  isFeatureLegible,
  pixelsPerRadianFromUniforms,
  type ScreenMetricUniforms,
} from '../../util/orbit-line';
import {
  probeSignalLost,
  probeStateAt,
  type ProbeState,
  type ProbeTrajectory,
} from './probe-trajectory';
import { setRawChromeColour } from '../../hdr/chrome/chrome-colour';
import type { EmitterMaterial } from '../../scene/emitter-material';
import type { ProbeMaterials } from '../materials/solar-system-materials';
import { makeGlslProbeMaterial } from '../materials/glsl-materials';
import {
  CADENCE_REPORT_STILL,
  fasterRate,
  type CadenceReport,
} from '../../render-gate/cadence/clock-cadence-pure';
import type { CadenceCtx } from '../../scene/scene-layer';
import { angleBetweenRad } from '../../util/angles';

/** Marker edge length in CSS pixels, and the basis for any hit radius over
 *  it. Fixed at every range: a metre-scale probe has no angular diameter to
 *  resolve and no reflected magnitude to sit on the slider, so the glyph is
 *  chrome, not a rendered body. */
export const PROBE_MARKER_PX = 9;

const PROBE_COLOUR = 0xd8e4f2;
const MARKER_ALPHA = 0.92;
/** Opacity once a probe's last contact has passed — still coasting, no
 *  longer answering. Dim enough to read as changed state at marker size. */
const SIGNAL_LOST_ALPHA = 0.4;

// Main pass, above the star discs and below the planet glare so a marker
// overlapping a bright body doesn't paint over its disc.
const MARKER_RENDER_ORDER = 3.5;

// Local-depth-pass in-pass order: after the planet disc mirrors (3) and the
// orbit rings (3.2) so the marker depth-tests against real body depth, and
// below the star glow mirror (3.5) — the same slot ordering the ring layer
// documents. See src/client/local-depth/README.md.
const MARKER_LOCAL_RENDER_ORDER = 3.3;

/** The star pipeline's viewport / FOV / pixel-ratio slots, by reference, so a
 *  resize or FOV change reaches the marker material and the on-screen gates
 *  with no bookkeeping here. */
export type ProbeSharedUniforms =
  ScreenMetricUniforms & Pick<PerceptualDiscUniforms, 'uPixelRatio'>;

/** Per-probe geometry for this frame, shared with the trail layer, the
 *  label overlay, and every interaction surface so all of them agree on
 *  one sampler evaluation. */
export interface ProbeFrameSample {
  /** The trajectory covers this `t` — false before the first sample.
   *  `solRelPc` / `localPc` / `velPcPerSec` are meaningful only here. */
  sampled: boolean;
  /** Marker drawn: sampled AND inside the fleet distance cull AND not the
   *  observe-hidden instance AND permitted by the declutter cycle /
   *  render style. */
  visible: boolean;
  signalLost: boolean;
  /** Heliocentric ICRS offset from Sol, pc. */
  solRelPc: THREE.Vector3;
  /** Renderer-local marker position. */
  localPc: THREE.Vector3;
  /** Heliocentric ICRS velocity, pc per second — the sampler's own
   *  interpolated value, never a finite difference across frames. */
  velPcPerSec: THREE.Vector3;
}

/**
 * One instanced quad per probe. Own instance space — the domain index IS
 * the instance index, with no host indirection, because the roster is
 * flat and fixed at attach.
 */
export class ProbeField {
  readonly group: THREE.Group;
  /** Local-depth-pass mirror. The solar-system cluster parents this into the
   *  pass scene; exactly one of the two groups is ever visible. */
  readonly localGroup: THREE.Group;
  private trajectories: readonly ProbeTrajectory[] = [];
  private samples: ProbeFrameSample[] = [];
  /** Each marker's position as the LAST rendered frame drew it, parallel to
   *  `samples`. Only the cadence report's measured-displacement channel
   *  reads it; the rate itself rides the sampler's own velocity. */
  private prevLocalPc: THREE.Vector3[] = [];
  private permitted = true;
  private mono = false;
  private localPassActive = false;
  private hiddenIdx = -1;
  private worldOffset = new THREE.Vector3();
  /** Sol's renderer-local position. Sol is the catalog origin, so this is
   *  just the negated floating-origin offset — non-zero under any focus
   *  other than Sol. */
  private solLocal = new THREE.Vector3();
  private localPos = new Float32Array(0);
  private alpha = new Float32Array(0);
  private geometry: THREE.InstancedBufferGeometry;
  private material: EmitterMaterial;
  private localMaterial: EmitterMaterial;
  private mesh: THREE.Mesh;
  private localMesh: THREE.Mesh;
  private state: ProbeState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  private shared: ProbeSharedUniforms;

  constructor(
    shared: ProbeSharedUniforms,
    /** The TSL glyph on a WebGPU boot; absent = the shipped GLSL pair
     *  (`../materials/README.md`). */
    materials?: ProbeMaterials,
  ) {
    this.shared = shared;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.localGroup = new THREE.Group();
    this.localGroup.visible = false;
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute(
      'aCorner',
      new THREE.BufferAttribute(
        new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]),
        2,
      ),
    );
    this.geometry.setIndex([0, 1, 2, 1, 3, 2]);
    this.geometry.instanceCount = 0;
    // Two compile variants over one geometry. The mirror shares the
    // geometry outright — the instance buffers this.update writes are the
    // same ones it draws, so there is no attribute copy and no way for the
    // two passes to disagree about where a probe is.
    const factory = materials ?? makeGlslProbeMaterial(shared);
    const makeMat = (localPass = false) => {
      const m = factory.probeMarker(localPass);
      m.uniforms.uSizePx.value = PROBE_MARKER_PX;
      setRawChromeColour(m.uniforms.uColour.value as THREE.Color, PROBE_COLOUR);
      return m;
    };
    const makeMesh = (name: string, material: EmitterMaterial, renderOrder: number) => {
      const mesh = new THREE.Mesh(this.geometry, material.material);
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.renderOrder = renderOrder;
      return mesh;
    };
    this.material = makeMat();
    this.localMaterial = makeMat(true);
    this.mesh = makeMesh('probe-marker', this.material, MARKER_RENDER_ORDER);
    this.localMesh = makeMesh(
      'probe-marker-local', this.localMaterial, MARKER_LOCAL_RENDER_ORDER);
    this.group.add(this.mesh);
    this.localGroup.add(this.localMesh);
  }

  /** Bind the loaded roster and resolve `t`'s samples immediately. One-shot
   *  — the roster is fixed at load. The seed pass is what `PlanetBodyField`
   *  does at `attachHost`, and for the same reason: focus resolves before
   *  the first frame, so a record only `update` had written would leave
   *  `localPositionInto` false and drop the focus. */
  attach(trajectories: readonly ProbeTrajectory[], t: number): void {
    this.trajectories = trajectories;
    const n = trajectories.length;
    this.localPos = new Float32Array(n * 3);
    this.alpha = new Float32Array(n);
    this.samples = trajectories.map(() => ({
      sampled: false,
      visible: false,
      signalLost: false,
      solRelPc: new THREE.Vector3(),
      localPc: new THREE.Vector3(),
      velPcPerSec: new THREE.Vector3(),
    }));
    // Seeded on the attach sample, not at the origin: a first frame that
    // read a zero vector would measure every marker as having crossed the
    // sky, which the safety net would report as a violation.
    this.prevLocalPc = trajectories.map(() => new THREE.Vector3());
    const posAttr = new THREE.InstancedBufferAttribute(this.localPos, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    const alphaAttr = new THREE.InstancedBufferAttribute(this.alpha, 1);
    alphaAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('iLocalPos', posAttr);
    this.geometry.setAttribute('iAlpha', alphaAttr);
    this.geometry.instanceCount = n;
    this.resampleAt(t);
    for (let i = 0; i < n; i++) this.prevLocalPc[i].copy(this.samples[i].localPc);
  }

  /**
   * Resolve every trajectory at `t` into its `ProbeFrameSample`. Camera-
   * independent, so it is also the out-of-frame seed: `attach` and a clock
   * jump both land before the next `update`, and the focus path reads these
   * records rather than waiting for one.
   */
  resampleAt(t: number): void {
    for (let i = 0; i < this.trajectories.length; i++) {
      const traj = this.trajectories[i];
      const s = this.samples[i];
      s.sampled = probeStateAt(traj, t, this.state);
      s.signalLost = s.sampled && probeSignalLost(traj, t);
      if (!s.sampled) continue;
      s.solRelPc.set(this.state.x, this.state.y, this.state.z);
      s.localPc.copy(this.solLocal).add(s.solRelPc);
      s.velPcPerSec.set(this.state.vx, this.state.vy, this.state.vz);
    }
  }

  /**
   * Resample every probe at `t` and rewrite the instance buffers. Probes
   * are physical objects — they update regardless of focus, like planet
   * bodies. One fleet-scale distance cull rather than a per-probe one: the
   * markers hide together once the heliosphere itself stops subtending the
   * shared legibility floor, which is also the framing where a just-launched
   * probe sitting inside 1 AU still reads.
   */
  update(t: number, camera: THREE.PerspectiveCamera): void {
    if (this.trajectories.length === 0) {
      this.setDrawn(false);
      return;
    }
    for (let i = 0; i < this.samples.length; i++) {
      if (this.samples[i].sampled) this.prevLocalPc[i].copy(this.samples[i].localPc);
    }
    this.resampleAt(t);
    const drawn = this.permitted && !this.mono;
    this.setDrawn(drawn);
    const pxPerRad = pixelsPerRadianFromUniforms(this.shared);
    const fleetLegible = isFeatureLegible(
      HELIOPAUSE_EXTENT_PC, camera.position.distanceTo(this.solLocal), pxPerRad);
    for (let i = 0; i < this.trajectories.length; i++) {
      const s = this.samples[i];
      s.visible = s.sampled && fleetLegible && drawn && i !== this.hiddenIdx;
      if (s.sampled) {
        const base = i * 3;
        this.localPos[base] = s.localPc.x;
        this.localPos[base + 1] = s.localPc.y;
        this.localPos[base + 2] = s.localPc.z;
      }
      this.alpha[i] = s.visible
        ? (s.signalLost ? SIGNAL_LOST_ALPHA : MARKER_ALPHA)
        : 0;
    }
    (this.geometry.attributes.iLocalPos as THREE.InstancedBufferAttribute).needsUpdate = true;
    (this.geometry.attributes.iAlpha as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  /** Rebase onto a new floating origin. Every sample's `localPc` moves with
   *  it: the hard-focus setter reads `localPositionInto` immediately after
   *  the recentre it just triggered, so leaving them in the old frame would
   *  shift the camera by the whole recentre delta. The cadence snapshot
   *  rebases too, or the next frame reads the origin step as every marker
   *  jumping (the planet field's `prevBodyLocal64` does the same). */
  recenter(newWorldOffset: Readonly<THREE.Vector3>): void {
    const shift = this.solLocal.clone();
    this.worldOffset.copy(newWorldOffset);
    this.solLocal.copy(this.worldOffset).negate();
    shift.subVectors(this.solLocal, shift);
    for (let i = 0; i < this.samples.length; i++) {
      const s = this.samples[i];
      if (!s.sampled) continue;
      s.localPc.copy(this.solLocal).add(s.solRelPc);
      this.prevLocalPc[i].add(shift);
    }
  }

  /** This frame's cadence report over the markers actually drawn — the
   *  render gate's README owns the design.
   *
   *  One motion term per drawn marker: the sampler's own interpolated
   *  velocity (never a finite difference — the trajectory grid spacing runs
   *  from 88 s to six months, so a difference quotient is a different
   *  quantity in each part of a trajectory, § Sampler), minus the camera's,
   *  projected across the line of sight over the camera distance. A hidden,
   *  decluttered or unsampled probe moves no ink and reports nothing.
   *
   *  No brightness channel: signal-lost is a step in alpha at one instant,
   *  not a ramp, and it rides a discrete clock jump rather than the
   *  cadence. `observedPx` differences the drawn positions, which is the
   *  one thing here the sampler's velocity cannot audit. */
  cadenceReport(ctx: CadenceCtx): CadenceReport {
    const camPos = ctx.camera.position;
    const vc = ctx.cameraVelPcPerSimS;
    const dt = ctx.simDtS;
    const differenced = Number.isFinite(dt) && dt !== 0;
    let screenPxPerSimS = 0;
    let observedPx = 0;
    for (let i = 0; i < this.samples.length; i++) {
      const s = this.samples[i];
      if (!s.visible) continue;
      const dx = s.localPc.x - camPos.x;
      const dy = s.localPc.y - camPos.y;
      const dz = s.localPc.z - camPos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d <= 0) continue;
      const ux = dx / d;
      const uy = dy / d;
      const uz = dz / d;
      const vx = s.velPcPerSec.x - vc.x;
      const vy = s.velPcPerSec.y - vc.y;
      const vz = s.velPcPerSec.z - vc.z;
      const along = vx * ux + vy * uy + vz * uz;
      const tx = vx - along * ux;
      const ty = vy - along * uy;
      const tz = vz - along * uz;
      screenPxPerSimS = fasterRate(
        screenPxPerSimS,
        (Math.sqrt(tx * tx + ty * ty + tz * tz) / d) * ctx.pxPerRadian,
      );
      if (!differenced) continue;
      const q = this.prevLocalPc[i];
      observedPx = fasterRate(observedPx, ctx.pxPerRadian * angleBetweenRad(
        ux, uy, uz,
        q.x - (camPos.x - vc.x * dt),
        q.y - (camPos.y - vc.y * dt),
        q.z - (camPos.z - vc.z * dt),
      ));
    }
    return screenPxPerSimS === 0 && observedPx === 0
      ? CADENCE_REPORT_STILL
      : { screenPxPerSimS, fluxFracPerSimS: 0, observedPx, observedFluxFrac: 0 };
  }

  /** Sol's renderer-local position into `out` — the anchor the trail layer
   *  bakes its float32 vertices about. */
  solLocalInto(out: THREE.Vector3): void {
    out.copy(this.solLocal);
  }

  probeCount(): number {
    return this.trajectories.length;
  }

  probeAt(idx: number): ProbeTrajectory | null {
    return this.trajectories[idx] ?? null;
  }

  /** This frame's sampler verdict for one probe; null for an unused slot. */
  sampleFor(idx: number): Readonly<ProbeFrameSample> | null {
    return this.samples[idx] ?? null;
  }

  /** Renderer-local probe position into `out`; false only when the
   *  trajectory doesn't cover this frame's `t`. Gated on `sampled`, NOT
   *  on `visible`: focus, the focal ride, and overlay projection need the
   *  probe's position while it is decluttered, chart-hidden, or hidden as
   *  the observe anchor. Draw-predicate consumers read `sampleFor`. */
  localPositionInto(idx: number, out: THREE.Vector3): boolean {
    const s = this.samples[idx];
    if (!s || !s.sampled) return false;
    out.copy(s.localPc);
    return true;
  }

  /** Route the markers through the local depth pass instead of the main
   *  pass. Set by `SolarSystemCluster` each frame: while the solar system is
   *  locally active every one of its bodies renders in the bracketed pass
   *  with depth cleared, so a main-pass marker is painted over by any planet
   *  disc regardless of true depth. */
  setLocalPassActive(on: boolean): void {
    this.localPassActive = on;
    this.setDrawn(this.group.visible || this.localGroup.visible);
  }

  private setDrawn(drawn: boolean): void {
    this.group.visible = drawn && !this.localPassActive;
    this.localGroup.visible = drawn && this.localPassActive;
  }

  setPermitted(on: boolean): void {
    this.permitted = on;
    if (!on) this.setDrawn(false);
  }

  /** Suppress one probe's marker (and, through `visible`, its label and
   *  trail) — the observe-anchor hide, since the camera parks exactly on
   *  the marker. -1 unhides. */
  setHiddenInstance(idx: number): void {
    this.hiddenIdx = idx;
  }

  /** Chart mode has no probe glyph — the markers hide rather than render
   *  their realistic-style diamond over the paper aesthetic. */
  setMonochrome(on: boolean): void {
    this.mono = on;
    if (on) this.setDrawn(false);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.localMaterial.dispose();
  }
}

// Instanced fixed-size marker per deep-space probe, positioned from the
// trajectory sampler each frame. See README.md § Marker field.

import * as THREE from 'three';
import { HELIOPAUSE_EXTENT_PC } from '../heliopause/heliopause';
import type { PerceptualDiscUniforms } from '../../star-pipeline/perceptual-disc-uniforms';
import { isFeatureLegible, pixelsPerRadianFromFovRad } from '../../util/orbit-line';
import {
  probeSignalLost,
  probeStateAt,
  type ProbeState,
  type ProbeTrajectory,
} from './probe-trajectory';
import probeVert from './probe.vert.glsl?raw';
import probeFrag from './probe.frag.glsl?raw';

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

/** The star pipeline's viewport / FOV slots, by reference, so a resize or
 *  FOV change reaches the marker material and the on-screen gates with no
 *  bookkeeping here. */
export type ProbeSharedUniforms =
  Pick<PerceptualDiscUniforms, 'uViewport' | 'uPixelRatio' | 'uFovYRad'>;

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
  private trajectories: readonly ProbeTrajectory[] = [];
  private samples: ProbeFrameSample[] = [];
  private permitted = true;
  private mono = false;
  private hiddenIdx = -1;
  private worldOffset = new THREE.Vector3();
  /** Sol's renderer-local position. Sol is the catalog origin, so this is
   *  just the negated floating-origin offset — non-zero under any focus
   *  other than Sol. */
  private solLocal = new THREE.Vector3();
  private localPos = new Float32Array(0);
  private alpha = new Float32Array(0);
  private geometry: THREE.InstancedBufferGeometry;
  private material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private state: ProbeState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  private shared: ProbeSharedUniforms;

  constructor(shared: ProbeSharedUniforms) {
    this.shared = shared;
    this.group = new THREE.Group();
    this.group.visible = false;
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
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: probeVert,
      fragmentShader: probeFrag,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      uniforms: {
        uViewport: shared.uViewport,
        uPixelRatio: shared.uPixelRatio,
        uSizePx: { value: PROBE_MARKER_PX },
        uColour: { value: new THREE.Color(PROBE_COLOUR) },
      },
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = MARKER_RENDER_ORDER;
    this.group.add(this.mesh);
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
    const posAttr = new THREE.InstancedBufferAttribute(this.localPos, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    const alphaAttr = new THREE.InstancedBufferAttribute(this.alpha, 1);
    alphaAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('iLocalPos', posAttr);
    this.geometry.setAttribute('iAlpha', alphaAttr);
    this.geometry.instanceCount = n;
    this.resampleAt(t);
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
      this.group.visible = false;
      return;
    }
    this.resampleAt(t);
    const drawn = this.permitted && !this.mono;
    this.group.visible = drawn;
    const pxPerRad = pixelsPerRadianFromFovRad(
      this.shared.uFovYRad.value, this.shared.uViewport.value.y);
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
   *  it: `setProbeFocus` reads `localPositionInto` immediately after the
   *  recentre it just triggered, so leaving them in the old frame would
   *  shift the camera by the whole recentre delta. */
  recenter(newWorldOffset: Readonly<THREE.Vector3>): void {
    this.worldOffset.copy(newWorldOffset);
    this.solLocal.copy(this.worldOffset).negate();
    for (const s of this.samples) {
      if (s.sampled) s.localPc.copy(this.solLocal).add(s.solRelPc);
    }
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

  setPermitted(on: boolean): void {
    this.permitted = on;
    if (!on) this.group.visible = false;
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
    if (on) this.group.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

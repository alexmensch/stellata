// The reflected-glare billboard on a WebGPU boot: packed geometry over
// PlanetBodyField's live arrays, the main-pass draw and its local-pass
// mirror, and the per-frame re-pack. README.md § The glare packs.

import * as THREE from 'three';
import { applyGlowBlendDefaults, applyMonochromeBlend } from '../../star-pipeline/star-pipeline';
import type { EmitterGateNodes } from '../hdr/emitter-gates';
import type { MrtOutputLayer } from '../hdr/hdr-pipeline-webgpu';
import type { SharedUniformNodes } from '../shared-uniform-nodes';
import {
  buildPlanetGlareGeometry, packGlareInstances,
  type PlanetGlareBuild, type PlanetGlareSources,
} from './planet-glare-geometry';
import { buildPlanetGlareMaterial } from './planet-glare-tsl';
import { glareUniformNodes, type GlareUniformNodes } from './planet-glare-uniforms';

/** Glare last (4) so a transiting body's glare adds over everything,
 *  including a parent mesh behind it — the WebGL stack's own order. */
const GLARE_RENDER_ORDER = 4;

export class PlanetGlareLayer implements MrtOutputLayer {
  readonly mesh: THREE.Mesh;
  /** The local-pass mirror. Added to the seam's scene but left invisible
   *  until the local depth pass ports — with no bracketed pass to draw it,
   *  a visible mirror would double every body's glare. */
  readonly mirrorMesh: THREE.Mesh;

  private readonly scene: THREE.Scene;
  private readonly sources: PlanetGlareSources;
  private readonly nodes: GlareUniformNodes;
  private readonly materials: ReturnType<typeof buildPlanetGlareMaterial>[];
  private build: PlanetGlareBuild;
  private layout = -1;
  private mono = false;

  constructor(
    scene: THREE.Scene,
    u: SharedUniformNodes,
    sources: PlanetGlareSources,
    gates: EmitterGateNodes,
  ) {
    this.scene = scene;
    this.sources = sources;
    this.nodes = glareUniformNodes();
    const bufs = sources.buffers();
    this.build = buildPlanetGlareGeometry(bufs, bufs.radius.length);
    const main = buildPlanetGlareMaterial(u, this.nodes, gates, false);
    const mirror = buildPlanetGlareMaterial(u, this.nodes, gates, true);
    this.materials = [main, mirror];
    for (const m of this.materials) applyGlowBlendDefaults(m.material);

    const mesh = (material: THREE.Material, name: string) => {
      const m = new THREE.Mesh(this.build.geometry, material);
      m.name = name;
      m.frustumCulled = false;
      m.renderOrder = GLARE_RENDER_ORDER;
      // Both meshes carry the hook — either may be the one drawn — and
      // the re-pack is idempotent, so a frame that draws both pays it
      // twice over tens of slots rather than needing a frame sentinel.
      m.onBeforeRender = () => this.sync();
      scene.add(m);
      return m;
    };
    this.mesh = mesh(main.material, 'planet-glare-webgpu');
    this.mirrorMesh = mesh(mirror.material, 'planet-glare-local-webgpu');
    this.mirrorMesh.visible = false;
  }

  setMrtOutputs(on: boolean): void {
    for (const m of this.materials) m.setMrtOutputs(on);
  }

  /** Chart mode's flat-ink blend, the swap `PlanetBodyField` applies to
   *  the WebGL material. */
  setMonochrome(on: boolean): void {
    if (on === this.mono) return;
    this.mono = on;
    for (const m of this.materials) {
      if (on) applyMonochromeBlend(m.material);
      else applyGlowBlendDefaults(m.material);
      m.material.needsUpdate = true;
    }
  }

  setVisible(on: boolean): void {
    this.mesh.visible = on;
  }

  /**
   * Re-pack and re-flag every per-instance attribute.
   *
   * Unconditional rather than version-watched, unlike the star layer's:
   * a host's whole body count is tens of slots, so the re-pack and the
   * re-upload together are a few kilobytes a frame — far below what
   * tracking which of twelve source arrays moved would cost to get wrong.
   */
  private sync(): void {
    const count = this.sources.instanceCount();
    const layout = this.sources.layoutVersion();
    if (layout !== this.layout) {
      this.layout = layout;
      const bufs = this.sources.buffers();
      if (bufs.radius.length !== this.build.capacity) {
        const old = this.build;
        this.build = buildPlanetGlareGeometry(bufs, bufs.radius.length);
        this.mesh.geometry = this.build.geometry;
        this.mirrorMesh.geometry = this.build.geometry;
        old.geometry.dispose();
      }
    }
    packGlareInstances(this.build, this.sources.buffers(), count);
    for (const attr of this.build.instanced) attr.needsUpdate = true;
    this.build.geometry.instanceCount = count;

    this.nodes.uHideIdx.value = this.sources.hideIdx();
    const range = this.sources.localPassRange();
    this.nodes.uLocalPassRange.value.set(range[0], range[1]);
  }

  dispose(): void {
    for (const m of [this.mesh, this.mirrorMesh]) {
      this.scene.remove(m);
      (m.material as THREE.Material).dispose();
    }
    this.build.geometry.dispose();
    this.layout = -1;
  }
}

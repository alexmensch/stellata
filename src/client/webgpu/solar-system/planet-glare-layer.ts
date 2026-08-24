// The reflected-glare billboard on a WebGPU boot: packed geometry over
// PlanetBodyField's live arrays, the main-pass draw and its local-pass
// mirror, and the per-frame re-pack. README.md § The glare packs.

import * as THREE from 'three';
import { applyGlowBlendDefaults, applyMonochromeBlend } from '../../star-pipeline/star-pipeline';
import type { EmitterGateNodes } from '../hdr/emitter-gates';
import type { MrtOutputLayer } from '../hdr/hdr-pipeline-webgpu';
import type { SharedUniformNodes } from '../shared-uniform-nodes';
import {
  buildPlanetGlareGeometry, packGlareFrame, packGlareLayout,
  type PlanetGlareBuild, type PlanetGlareSources,
} from './planet-glare-geometry';
import { buildPlanetGlareMaterial } from './planet-glare-tsl';
import { glareUniformNodes, type GlareUniformNodes } from './planet-glare-uniforms';

/** Glare last (4) so a transiting body's glare adds over everything,
 *  including a parent mesh behind it — the WebGL stack's own order. */
const GLARE_RENDER_ORDER = 4;

export class PlanetGlareLayer implements MrtOutputLayer {
  readonly mesh: THREE.Mesh;
  /** The local-pass mirror, parented into `mirrorParent` (the field's
   *  localGroup, which the solar-system cluster carries into the pass
   *  scene). Gated per instance by `uLocalPassRange`, exactly as the
   *  GLSL mirror is — it draws nothing while no cluster is active. */
  readonly mirrorMesh: THREE.Mesh;

  private readonly scene: THREE.Scene;
  private readonly mirrorParent: THREE.Object3D;
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
    mirrorParent: THREE.Object3D,
  ) {
    this.scene = scene;
    this.mirrorParent = mirrorParent;
    this.sources = sources;
    this.nodes = glareUniformNodes();
    const bufs = sources.buffers();
    this.build = buildPlanetGlareGeometry(bufs, bufs.radius.length);
    const main = buildPlanetGlareMaterial(u, this.nodes, gates, false);
    const mirror = buildPlanetGlareMaterial(u, this.nodes, gates, true);
    this.materials = [main, mirror];
    for (const m of this.materials) applyGlowBlendDefaults(m.material);

    const mesh = (material: THREE.Material, name: string, parent: THREE.Object3D) => {
      const m = new THREE.Mesh(this.build.geometry, material);
      m.name = name;
      m.frustumCulled = false;
      m.renderOrder = GLARE_RENDER_ORDER;
      // Both meshes carry the hook — either may be the one drawn — and
      // the re-pack is idempotent, so a frame that draws both pays it
      // twice over tens of slots rather than needing a frame sentinel.
      m.onBeforeRender = () => this.sync();
      parent.add(m);
      return m;
    };
    this.mesh = mesh(main.material, 'planet-glare-webgpu', scene);
    this.mirrorMesh = mesh(mirror.material, 'planet-glare-local-webgpu', mirrorParent);
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
   * Re-pack and re-flag the per-instance attributes, split by how often
   * the field actually rewrites them.
   *
   * The seam is the field's own: `writeHostStaticAttributes` fires on
   * attach / detach / grow — exactly what `layoutVersion` reports — while
   * `writeHostPositions` and the dim/ring-flux blends fire every frame.
   * So the phase coefficients, colour, solidity, radius, albedo and host
   * magnitude re-upload only when a body joins or leaves, and the frame
   * pays three attributes rather than seven. Note `iHostLocalPos` counts
   * as per-frame despite being static per body: a floating-origin
   * recentre rewrites it with no `layoutVersion` bump.
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
      packGlareLayout(this.build, bufs, count);
      for (const attr of this.build.perLayout) attr.needsUpdate = true;
    }
    packGlareFrame(this.build, this.sources.buffers(), count);
    for (const attr of this.build.perFrame) attr.needsUpdate = true;
    this.build.geometry.instanceCount = count;

    this.nodes.uHideIdx.value = this.sources.hideIdx();
    const range = this.sources.localPassRange();
    this.nodes.uLocalPassRange.value.set(range[0], range[1]);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mirrorParent.remove(this.mirrorMesh);
    for (const m of [this.mesh, this.mirrorMesh]) {
      (m.material as THREE.Material).dispose();
    }
    this.build.geometry.dispose();
    this.layout = -1;
  }
}

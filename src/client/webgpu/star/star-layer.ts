// The star layer on a WebGPU boot: star-indexed storage tables, the
// compaction kernel, and the three TSL star meshes (core mask, disc, glow)
// drawn indirect at survivor count. Constructed through WebGpuSeam.attachStarLayer.

import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { makeColorLutTexture } from '../../star-pipeline/blackbody-lut';
import { DEPTH_MASK_RENDER_ORDER } from '../../scene/render-order';
import { STAR_FORWARDED_ATTRIBUTES } from '../star-attribute-roster';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import type { ExtinctionNodes } from '../extinction/extinction-nodes';
import type { EmitterGateNodes } from '../hdr/emitter-gates';
import { STAR_TIER_DISC, STAR_TIER_GLOW, tierListBase, type StarTier } from './compaction/compaction-pure';
import { StarCompaction } from './compaction/star-compaction';
import { STAR_QUAD_INDEX_COUNT, buildStarGeometries, type StarGeometries } from './star-geometry';
import { StarTables, type StarLayerSources } from './star-tables';
import { applyChartBlendSwap } from '../../star-pipeline/star-pipeline';
import { buildStarCoreMaskMaterial } from './star-core-mask-tsl';
import { applyStarDiscTslBlend, buildStarDiscMaterial } from './star-disc-tsl';
import { buildStarGlowMaterial } from './star-glow-tsl';
import { StarLocalMirrorTsl } from './star-local-mirror-tsl';
import type { MrtEmitterMaterial } from '../hdr/mrt-material';
import type { StarTslDeps, StarVertexSource } from './star-vertex-tsl';

/** Storage buffers a main-pass star vertex stage binds — the count the boot
 *  holds the device to (../tsl/README.md § Storage attributes). */
export const STAR_VERTEX_STAGE_STORAGE_BUFFERS =
  ['survivors', 'av', 'statics', ...STAR_FORWARDED_ATTRIBUTES].length;

export class StarLayer {
  /** Depth-only member/core stamp, first in the frame (renderOrder −4);
   *  `visible` is the shell's CPU gate, exactly as on the WebGL mesh.
   *  This is the ONLY depth a disc core gets on this backend — the disc
   *  draw writes none (README.md § The disc draw writes no depth). */
  readonly coreMaskMesh: THREE.Mesh;
  readonly discMesh: THREE.Mesh;
  readonly glowMesh: THREE.Mesh;
  /** Owned by this layer alone — the WebGL pipeline builds its own. */
  readonly colorLut: THREE.DataTexture;
  /** NOT in the scene above: the shell hands it to StarLocalCluster, which
   *  parents it into the pass scene and owns its dispose — the same split as
   *  the GLSL mirror. */
  readonly localMirror: StarLocalMirrorTsl;
  readonly tables: StarTables;
  readonly compaction: StarCompaction;

  private readonly renderer: WebGPURenderer;
  private readonly scene: THREE.Scene;
  private readonly geometries: StarGeometries;
  /** Every material that draws into the HDR target, mask included — the
   *  set `setMrtOutputs` swaps. */
  private readonly targetMaterials: MrtEmitterMaterial[];
  /** The two materials chart mode swaps to flat ink. The mirror's clones
   *  never take the swap: local-pass membership parks in chart mode, so
   *  they have nothing to draw — the same split the GLSL
   *  `setMonochromeBlend` makes. */
  private readonly discMaterial: THREE.Material;
  private readonly glowMaterial: THREE.Material;

  constructor(
    renderer: WebGPURenderer,
    scene: THREE.Scene,
    nodes: SharedUniformNodes,
    sources: StarLayerSources,
    gates: EmitterGateNodes,
    extinction: ExtinctionNodes,
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.tables = new StarTables(sources);
    this.colorLut = makeColorLutTexture();
    const deps: StarTslDeps = {
      u: nodes,
      tables: this.tables,
      lut: this.colorLut,
      dust: extinction.dust,
      av: extinction.av,
    };
    this.compaction = new StarCompaction(renderer, deps, STAR_QUAD_INDEX_COUNT);
    this.geometries = buildStarGeometries(
      this.tables.count, sources.boundingSphereRadiusPc, this.compaction.args);
    const listSource = (tier: StarTier): StarVertexSource => ({
      kind: 'compacted',
      survivors: this.compaction.survivorsNode,
      listBase: tierListBase(tier, this.tables.count),
    });

    const mesh = (
      geometry: THREE.InstancedBufferGeometry,
      material: THREE.Material,
      name: string,
      renderOrder: number,
    ) => {
      const m = new THREE.Mesh(geometry, material);
      m.name = name;
      m.frustumCulled = false;
      m.renderOrder = renderOrder;
      scene.add(m);
      return m;
    };
    // renderOrder mirrors the WebGL stack exactly, three draws and no
    // more: core mask (−4) → background layers → disc (0) → glow (1).
    const mask = buildStarCoreMaskMaterial(deps, listSource(STAR_TIER_DISC));
    const disc = buildStarDiscMaterial(deps, gates, listSource(STAR_TIER_DISC));
    const glow = buildStarGlowMaterial(deps, gates, listSource(STAR_TIER_GLOW));
    this.targetMaterials = [mask, disc, glow];
    this.discMaterial = disc.material;
    this.glowMaterial = glow.material;
    this.coreMaskMesh = mesh(
      this.geometries.disc, mask.material, 'star-core-mask-webgpu', DEPTH_MASK_RENDER_ORDER);
    this.coreMaskMesh.visible = false;
    this.discMesh = mesh(this.geometries.disc, disc.material, 'star-disc-webgpu', 0);
    this.glowMesh = mesh(this.geometries.glow, glow.material, 'star-glow-webgpu', 1);
    this.localMirror = new StarLocalMirrorTsl(this.geometries.glow, deps, gates);
  }

  /** Every mesh this layer owns, in draw order. */
  private meshes(): THREE.Mesh[] {
    return [this.coreMaskMesh, this.discMesh, this.glowMesh];
  }

  /** Swap every material that draws into the target between its
   *  single-output fragment and the three-member MRT struct — driven by
   *  the HDR pipeline in lockstep with its target mode (../hdr/README.md
   *  § The gate becomes the output struct). The core mask swaps too, for
   *  three's pipeline cache rather than for validity
   *  (star-core-mask-tsl.ts). The mirror's draws land in the same target,
   *  so they ride the same swap. */
  setMrtOutputs(on: boolean): void {
    for (const m of this.targetMaterials) m.setMrtOutputs(on);
    this.localMirror.setMrtOutputs(on);
  }

  /** The shell's per-frame CPU gate — skip the whole depth-only draw when
   *  no member and no close star can stamp anything
   *  (../../star-pipeline/README.md § Star rendering). */
  setCoreMaskVisible(on: boolean): void {
    this.coreMaskMesh.visible = on;
  }

  /** Chart mode's blend swap, over the same pair helper `StarPipeline`'s
   *  `setMonochromeBlend` takes — only the disc-defaults argument differs.
   *  `uMonochrome` is a shared node the shell writes; swap-back goes
   *  through the construction helper, so the two cannot drift
   *  (star-disc-tsl.ts § applyStarDiscTslBlend). The core mask takes no
   *  BLEND swap (colour writes are off, so its blend state is
   *  unobservable) even though it does take the MRT one above. */
  setMonochrome(on: boolean): void {
    applyChartBlendSwap(
      this.discMaterial, this.glowMaterial, on, applyStarDiscTslBlend);
  }

  /** The frame's compaction: forward this frame's attribute writes onto the
   *  tables, then dispatch the kernel that lists the survivors every draw
   *  below reads, tested against this camera. After the shell's
   *  uniform-node sync, before its render. */
  update(camera: THREE.Camera): void {
    this.tables.syncSources();
    this.compaction.dispatch(camera);
    this.tables.endFrame();
  }

  /** compaction/README.md § Reading the counts back. */
  readSurvivorCounts() {
    return this.compaction.readSurvivorCounts();
  }

  dispose(): void {
    for (const m of this.meshes()) {
      this.scene.remove(m);
      (m.material as THREE.Material).dispose();
    }
    this.geometries.glow.dispose();
    this.geometries.disc.dispose();
    this.colorLut.dispose();
    this.compaction.dispose();
    this.tables.dispose(this.renderer);
  }
}

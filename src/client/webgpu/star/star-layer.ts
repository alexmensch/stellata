// The star layer on a WebGPU boot: packed geometry + the three TSL star
// meshes (core mask, disc, glow), added to the seam's scene. Constructed
// through WebGpuSeam.attachStarLayer.

import * as THREE from 'three';
import { makeColorLutTexture } from '../../star-pipeline/blackbody-lut';
import {
  packedUploadRange, repackScalarInPlace, repackScalarRange,
} from '../tsl/attribute-packing-pure';
import { STAR_DYNAMIC_SCALARS } from '../star-attribute-roster';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import type { ExtinctionTextureNodes } from '../extinction/extinction-texture-nodes';
import type { EmitterGateNodes } from '../hdr/emitter-gates';
import {
  buildStarGeometry,
  dynamicScalarSourceAttrs,
  type StarGeometryBuild,
  type StarGeometrySources,
} from './star-geometry';
import { applyChartBlendSwap } from '../../star-pipeline/star-pipeline';
import { buildStarCoreMaskMaterial } from './star-core-mask-tsl';
import { applyStarDiscTslBlend, buildStarDiscMaterial } from './star-disc-tsl';
import { buildStarGlowMaterial } from './star-glow-tsl';
import { StarLocalMirrorTsl } from './star-local-mirror-tsl';
import type { MrtEmitterMaterial } from '../hdr/mrt-material';
import type { StarTslDeps } from './star-vertex-tsl';

interface DynamicWatcher {
  name: (typeof STAR_DYNAMIC_SCALARS)[number];
  src: THREE.InstancedBufferAttribute;
  /** Sentinel -1: the first rendered frame always re-packs, so a write
   *  landing between construction and first render cannot be missed. */
  last: number;
}

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
  /** The local-depth-pass mirror. NOT in the seam's scene: the shell hands
   *  it to StarLocalCluster, which parents it into the pass scene and owns
   *  its dispose — the same split as the GLSL mirror. */
  readonly localMirror: StarLocalMirrorTsl;

  private readonly scene: THREE.Scene;
  private readonly build: StarGeometryBuild;
  private readonly dynArrays: Float32Array[];
  private readonly watchers: DynamicWatcher[];
  /** Every material that draws into the HDR target, mask included — the
   *  set `setMrtOutputs` swaps. */
  private readonly targetMaterials: MrtEmitterMaterial[];
  /** The two materials chart mode swaps to flat ink. The mirror's clones
   *  never take the swap: local-pass membership parks in chart mode, so
   *  they have nothing to draw — the same split the GLSL
   *  `setMonochromeBlend` makes. */
  private readonly discMaterial: THREE.Material;
  private readonly glowMaterial: THREE.Material;
  /** Per-frame scratch, one slot per packed dynamic buffer — reused so the
   *  render loop allocates nothing. */
  private readonly pendingFull: boolean[];
  private readonly pendingRanges: { start: number; count: number }[][];

  constructor(
    scene: THREE.Scene,
    nodes: SharedUniformNodes,
    sources: StarGeometrySources,
    gates: EmitterGateNodes,
    textures: ExtinctionTextureNodes,
  ) {
    this.scene = scene;
    this.build = buildStarGeometry(sources);
    this.dynArrays = this.build.dynAttrs.map((a) => a.array as Float32Array);
    const sourceAttrs = dynamicScalarSourceAttrs(sources);
    this.watchers = STAR_DYNAMIC_SCALARS.map((name) => ({
      name, src: sourceAttrs[name], last: -1,
    }));
    this.pendingFull = this.build.dynAttrs.map(() => false);
    this.pendingRanges = this.build.dynAttrs.map(() => []);
    this.colorLut = makeColorLutTexture();
    const deps: StarTslDeps = {
      u: nodes,
      staticPlan: this.build.staticPlan,
      dynamicPlan: this.build.dynamicPlan,
      lut: this.colorLut,
      dust: textures.dust,
      avPrepass: textures.avPrepass,
    };

    const mesh = (material: THREE.Material, name: string, renderOrder: number) => {
      const m = new THREE.Mesh(this.build.geometry, material);
      m.name = name;
      m.frustumCulled = false;
      m.renderOrder = renderOrder;
      // Every mesh carries the sync hook: whichever draws first this frame
      // does the re-pack, and the version sentinels make the rest no-ops —
      // the core mask may be gated invisible, so no single mesh can own it.
      m.onBeforeRender = () => this.syncDynamicAttributes();
      scene.add(m);
      return m;
    };
    // renderOrder mirrors the WebGL stack exactly, three draws and no
    // more: core mask (−4) → background layers → disc (0) → glow (1).
    const mask = buildStarCoreMaskMaterial(deps);
    const disc = buildStarDiscMaterial(deps, gates);
    const glow = buildStarGlowMaterial(deps, gates);
    this.targetMaterials = [mask, disc, glow];
    this.discMaterial = disc.material;
    this.glowMaterial = glow.material;
    this.coreMaskMesh = mesh(mask.material, 'star-core-mask-webgpu', -4);
    this.coreMaskMesh.visible = false;
    this.discMesh = mesh(disc.material, 'star-disc-webgpu', 0);
    this.glowMesh = mesh(glow.material, 'star-glow-webgpu', 1);
    this.localMirror = new StarLocalMirrorTsl(
      this.build.geometry, deps, gates, () => this.syncDynamicAttributes());
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
   *  (star-disc-tsl.ts § applyStarDiscTslBlend). The core mask needs no
   *  swap: colour writes are off, so its blend state is unobservable. */
  setMonochrome(on: boolean): void {
    applyChartBlendSwap(
      this.discMaterial, this.glowMaterial, on, applyStarDiscTslBlend);
  }

  /** Re-pack any per-frame scalar whose source attribute was flagged
   *  since the last rendered frame (README.md § Dynamic attributes).
   *
   *  Load-bearing: ranges must lose to a full upload on the same buffer in
   *  the same frame. three.js honours a non-empty range list INSTEAD of
   *  the full array, so a range added beside a full pass would drop every
   *  slot outside it. */
  private syncDynamicAttributes(): void {
    const fullPass = this.pendingFull;
    const ranged = this.pendingRanges;
    fullPass.fill(false);
    for (const r of ranged) r.length = 0;

    for (const w of this.watchers) {
      if (w.src.version === w.last) continue;
      w.last = w.src.version;
      const srcRanges = w.src.updateRanges;
      if (srcRanges.length === 0) {
        fullPass[repackScalarInPlace(
          this.build.dynamicPlan, this.dynArrays, w.name, w.src.array)] = true;
        continue;
      }
      const itemSize = w.src.itemSize;
      for (const r of srcRanges) {
        const startItem = r.start / itemSize;
        const itemCount = r.count / itemSize;
        const buffer = repackScalarRange(
          this.build.dynamicPlan, this.dynArrays, w.name, w.src.array, startItem, itemCount);
        ranged[buffer].push(packedUploadRange(startItem, itemCount));
      }
      // Nothing else consumes these: on a WebGPU boot the WebGL geometry
      // never renders, so no renderer clears them and they would
      // accumulate to the uploader's range cap and force a full upload.
      w.src.clearUpdateRanges();
    }

    for (let b = 0; b < this.build.dynAttrs.length; b++) {
      const attr = this.build.dynAttrs[b];
      if (fullPass[b]) {
        attr.clearUpdateRanges();
        attr.needsUpdate = true;
      } else if (ranged[b].length > 0) {
        for (const r of ranged[b]) attr.addUpdateRange(r.start, r.count);
        attr.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    for (const m of this.meshes()) {
      this.scene.remove(m);
      (m.material as THREE.Material).dispose();
    }
    this.build.geometry.dispose();
    this.colorLut.dispose();
    for (const w of this.watchers) w.last = -1;
  }
}

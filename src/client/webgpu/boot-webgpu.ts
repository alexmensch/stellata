// Async half of the dual-boot seam: construct + init the WebGPURenderer
// and the seam handle. Loaded via import() from main.ts — the module (and
// three/webgpu with it) never reaches the WebGL2 bundle.

import { LinearSRGBColorSpace, Scene, WebGPURenderer } from 'three/webgpu';
import type * as THREE from 'three';
import type { SharedUniforms } from '../frame/shared-uniforms';
import type {
  PlanetGlareSources,
} from '../solar-system/planets/planet-body-field';
import { WebGpuExtinctionPrepass } from './extinction/extinction-prepass-webgpu';
import { ExtinctionTextureNodes } from './extinction/extinction-texture-nodes';
import { WebGpuHdrPipeline } from './hdr/hdr-pipeline-webgpu';
import {
  reversedDepthOpaqueSort, reversedDepthTransparentSort,
} from './reversed-depth-sort';
import { buildSharedUniformNodes, type SharedUniformNodeRegistry } from './shared-uniform-nodes';
import type {
  StarGeometrySources, WebGpuExtinctionPrepassSources, WebGpuSeam,
} from './seam';
import { PlanetGlareLayer } from './solar-system/planet-glare-layer';
import {
  makeTslProbeMaterial, makeTslSolarSystemMaterials,
} from './solar-system/tsl-materials';
import { StarLayer } from './star/star-layer';

/** Null when WebGPU is unavailable or init fails — the caller falls back
 *  to the shipped WebGL2 boot rather than showing a broken canvas. */
export async function bootWebGpu(canvas: HTMLCanvasElement): Promise<WebGpuSeam | null> {
  if (!('gpu' in navigator)) return null;
  const renderer = new WebGPURenderer({
    canvas,
    antialias: false,
    alpha: true,
    powerPreference: 'high-performance',
    reversedDepthBuffer: true,
    trackTimestamp: true,
  });
  try {
    await renderer.init();
  } catch (err) {
    // The reason only; the caller owns the fallback decision and says so.
    console.warn('WebGPURenderer.init() rejected:', err);
    renderer.dispose();
    return null;
  }
  // The local depth pass's single-bracket precision bound assumes float32
  // reversed-z storage; on a fixed-point attachment the K = 1 bracket is
  // wrong by ~262 AU at Neptune's ring (local-depth/bracket/README.md
  // § Precision analysis), so a boot that lost the flag must not proceed.
  if (renderer.reversedDepthBuffer !== true) {
    console.warn('WebGPURenderer dropped reversedDepthBuffer; falling back');
    renderer.dispose();
    return null;
  }
  // Counters r185's reversed-depth render-list reversal; retire with the
  // three bump (reversed-depth-sort.ts carries the mechanism).
  renderer.setOpaqueSort(reversedDepthOpaqueSort);
  renderer.setTransparentSort(reversedDepthTransparentSort);
  // Output stays in the working colour space: ported shaders own the
  // whole transfer chain (operator + sRGB encode), exactly as the GLSL
  // build's do, and any other setting makes three render the scene into
  // a hidden full-resolution target plus a colour-transform pass —
  // double-encoding every emitter and pricing an extra fullscreen pass
  // into every frame (README.md § Output colour space).
  renderer.outputColorSpace = LinearSRGBColorSpace;
  let registry: SharedUniformNodeRegistry | null = null;
  const scene = new Scene();
  const hdr = new WebGpuHdrPipeline(renderer);
  // One pair of texture slots for the whole boot: the star vertex stage's
  // fallback march and the prepass march sample the SAME dust node, so
  // `setDustTexture` cannot reach one and miss the other.
  const extinctionTextures = new ExtinctionTextureNodes();
  const nodesOrThrow = (caller: string) => {
    if (registry === null) throw new Error(`${caller} before bindSharedUniforms`);
    return registry.nodes;
  };
  const registerMrtLayer = (layer: Parameters<typeof hdr.registerMrtLayer>[0]) =>
    hdr.registerMrtLayer(layer);
  return {
    renderer,
    scene,
    hdr,
    timestampsAvailable: renderer.hasFeature('timestamp-query'),
    get uniformNodes() { return registry?.nodes ?? null; },
    bindSharedUniforms(shared: SharedUniforms) {
      registry = buildSharedUniformNodes(shared);
    },
    syncUniformNodes() {
      registry?.sync();
    },
    solarSystemMaterials(placeholder: THREE.Texture) {
      return makeTslSolarSystemMaterials({
        nodes: nodesOrThrow('solarSystemMaterials'),
        gates: hdr.gates,
        placeholder,
        registerMrtLayer,
      });
    },
    get probeMaterial() {
      return makeTslProbeMaterial({
        nodes: nodesOrThrow('probeMaterial'), registerMrtLayer,
      });
    },
    attachPlanetGlare(sources: PlanetGlareSources, mirrorParent: THREE.Object3D) {
      const layer = new PlanetGlareLayer(
        scene, nodesOrThrow('attachPlanetGlare'), sources, hdr.gates, mirrorParent);
      const unregister = hdr.registerMrtLayer(layer);
      return {
        setMonochrome: (on: boolean) => layer.setMonochrome(on),
        setVisible: (on: boolean) => layer.setVisible(on),
        dispose() {
          unregister();
          layer.dispose();
        },
      };
    },
    attachStarLayer(sources: StarGeometrySources) {
      const layer = new StarLayer(
        scene, nodesOrThrow('attachStarLayer'), sources, hdr.gates, extinctionTextures);
      // Registration is what keeps the layer's output count in lockstep
      // with the pipeline's target mode; dispose must sever it or a dead
      // layer keeps taking mode swaps.
      const unregister = hdr.registerMrtLayer(layer);
      return {
        setCoreMaskVisible: (on: boolean) => layer.setCoreMaskVisible(on),
        setMonochrome: (on: boolean) => layer.setMonochrome(on),
        localMirror: layer.localMirror,
        dispose() {
          unregister();
          layer.dispose();
        },
      };
    },
    setDustTexture(texture: THREE.Data3DTexture | null) {
      extinctionTextures.setDustTexture(texture);
    },
    attachExtinctionPrepass(options: WebGpuExtinctionPrepassSources) {
      return new WebGpuExtinctionPrepass({
        renderer,
        nodes: nodesOrThrow('attachExtinctionPrepass'),
        textures: extinctionTextures,
        ...options,
      });
    },
    dispose() {
      extinctionTextures.dispose();
      // The node registry holds no GPU resource — it mirrors the shell's
      // uniform value-objects, which the shell owns. Dropping it is what
      // makes a post-dispose attach throw rather than build against a
      // dead boot.
      registry = null;
    },
  };
}

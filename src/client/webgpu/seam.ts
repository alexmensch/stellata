// The dual-boot contract between the integration shell and the WebGPU
// boot path. Type-only — every three/webgpu VALUE import stays behind
// boot-webgpu.ts's dynamic import (see README.md § Import boundary).

import type * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { SharedUniforms } from '../frame/shared-uniforms';
import type { HdrSeam, ReductionSeam } from '../hdr/hdr-seam';
import type {
  PlanetGlareSources,
} from '../solar-system/planets/planet-body-field';
import type { ChromeLineMaterials } from '../chrome-lines/chrome-line-materials';
import type { DustParticleMaterials } from '../dust/dust-particle-layer';
import type { CloudMaterials } from '../molecular-clouds/cloud-materials';
import type { LgEmissionMaterials } from '../local-group/emission/lg-emission-materials';
import type { BandMaterials } from '../milkyway/band-materials';
import type { ShellMaterials } from '../fresnel-shell/fresnel-shell';
import type {
  ProbeMaterials, SolarSystemMaterials,
} from '../solar-system/materials/solar-system-materials';
import type {
  ExtinctionPrepassSeam, ExtinctionPrepassUniforms,
} from '../star-pipeline/extinction/extinction-seam';
import type { StarMirror } from '../star-pipeline/local-pass/star-mirror-slots';
import type { SharedUniformNodes } from './tsl/shared-uniform-nodes';
import type { StarGeometrySources } from './star/star-geometry';

export type StellataRenderer = THREE.WebGLRenderer | WebGPURenderer;

export type { StarGeometrySources } from './star/star-geometry';

/** What the shell supplies for the A_V cache; the renderer, the dust node
 *  and the uniform-node mirror are the seam's own. */
export interface WebGpuExtinctionPrepassSources {
  /** Absolute (heliocentric ICRS) star positions, xyz-interleaved —
   *  catalog.positions, NOT the floating-origin local buffer. */
  positions: Float32Array;
  count: number;
  uniforms: ExtinctionPrepassUniforms;
}

export interface WebGpuStarLayer {
  /** The shell's per-frame CPU gate on the depth-only core-mask draw —
   *  the same `visible` flip it applies to the WebGL mesh. */
  setCoreMaskVisible(on: boolean): void;
  /** Chart mode's flat-ink blend swap — the TSL twin of the WebGL
   *  pipeline's `setMonochromeBlend`, taken from the same `setMonochrome`
   *  call site. */
  setMonochrome(on: boolean): void;
  /** The local-depth-pass mirror this layer built. The shell hands it to
   *  StarLocalCluster in place of the GLSL StarLocalMirror; the cluster
   *  parents its group into the pass scene and owns its dispose. */
  readonly localMirror: StarMirror;
  dispose(): void;
}

/** The WebGPU HDR pipeline as the shell sees it: the backend-neutral seam
 *  plus the reduction it owns (the WebGL boot constructs the two
 *  separately). */
export interface WebGpuHdrSeam extends HdrSeam {
  readonly reduction: ReductionSeam;
}

export interface WebGpuSeam {
  readonly renderer: WebGPURenderer;
  /** Rendered in place of the shell's scene on a WebGPU boot — empty
   *  until port children add their TSL layers to it. */
  readonly scene: THREE.Scene;
  /** The boot probe's verdict on whether timestamp queries survive
   *  validation, NOT the adapter's grant — Safari 26 grants the feature and
   *  then refuses the query set. Every GPU-timing consumer must ask here,
   *  and the render loop's resolve is gated on it: with tracking off three
   *  allocates no query pool, so resolving anyway only warns
   *  (README.md § Timestamps). */
  readonly timestampsAvailable: boolean;
  /** The HDR chain on this boot — target, resolve, reduction. The shell
   *  drives it in place of constructing the WebGL HdrPipeline. */
  readonly hdr: WebGpuHdrSeam;
  /** Built by the shell right after buildSharedUniforms; null before. */
  readonly uniformNodes: SharedUniformNodes | null;
  bindSharedUniforms(shared: SharedUniforms): void;
  /** Per-frame scalar copy from the WebGL-side map into the nodes —
   *  called from animate() before the render (README.md § Shared
   *  uniform nodes). */
  syncUniformNodes(): void;
  /** Build the TSL star layer into the seam's scene. Requires
   *  bindSharedUniforms to have run — the materials take their slots
   *  from the uniform-node mirror. */
  attachStarLayer(sources: StarGeometrySources): WebGpuStarLayer;
  /** Bind (or release) the dust volume for every TSL consumer that samples
   *  it. One node, shared by object identity between the star vertex
   *  stage's fallback march and the extinction prepass, so the shell's
   *  single `attachDust` reaches both. Textures are not part of the
   *  uniform-node mirror (tsl/README.md § Shared uniform nodes), which is why
   *  this is a call rather than a map write. */
  setDustTexture(texture: THREE.Data3DTexture | null): void;
  /** Build the per-star A_V cache on this backend. It points the star
   *  layer's A_V texture slot at its own target, so the shell wires
   *  nothing beyond holding the handle. */
  attachExtinctionPrepass(
    options: WebGpuExtinctionPrepassSources,
  ): ExtinctionPrepassSeam;
  /** Release the boot-scoped GPU resources the seam owns and the shell has
   *  no handle to — today the shared extinction texture slots and their
   *  placeholders. NOT the renderer or the HDR pipeline: the shell holds
   *  both as its own fields (`renderer`, `hdr`) and disposes them on
   *  either backend, so disposing them here would double-release.
   *
   *  Call AFTER every attached layer and the prepass, since those hand
   *  their slots back to the placeholders this then frees. A new
   *  boot-scoped allocation in `boot-webgpu.ts` belongs here — that is the
   *  only path that reaches it. */
  dispose(): void;
  /** The TSL planet surfaces, over the caller's 1×1 placeholder — the
   *  mesh layer owns that texture on either backend, so the factory takes
   *  it rather than the other way round. */
  solarSystemMaterials(placeholder: THREE.Texture): SolarSystemMaterials;
  /** The TSL probe glyph, which reads no texture and so needs no
   *  placeholder — the split mirrors `makeGlslProbeMaterial`. Read it
   *  ONCE per field: each read is a fresh factory, and the shared-material
   *  refcount lives inside one. */
  readonly probeMaterial: ProbeMaterials;
  /** The TSL chrome line strokes. Read only AFTER `bindSharedUniforms`:
   *  building the graphs resolves the shared uniform nodes, so an earlier
   *  read throws (`../chrome-lines/README.md` § One factory per boot). */
  readonly chromeLineMaterials: ChromeLineMaterials;
  /** The TSL boundary-shell surface (heliopause, Local Bubble). Each
   *  consumer builds its own — colour, limb alpha and blend are per-shell. */
  readonly shellMaterials: ShellMaterials;
  /** The TSL dust-particle sprite. Its six shared slots come off the
   *  uniform-node mirror, so the factory takes no uniform argument of its
   *  own (`dust/tsl-dust-materials.ts`). */
  readonly dustParticleMaterials: DustParticleMaterials;
  /** The TSL molecular-cloud surfaces: one absorption material per cloud
   *  (the traced / analytic tier is compile-time, so they cannot share) and
   *  one rim shell for all of them. */
  readonly cloudMaterials: CloudMaterials;
  /** The TSL Local Group emission passes, one per family. Every uniform
   *  they read is in the node mirror, so neither carries a slot record. */
  readonly lgEmissionMaterials: LgEmissionMaterials;
  /** The TSL Milky Way band, disc and bulge. Read it ONCE per layer: the
   *  slots the two components share by reference are built per factory, so
   *  two reads would give two independent dust models. */
  readonly bandMaterials: BandMaterials;
  /** Build the TSL reflected-glare billboard into the seam's scene. The
   *  one solar-system surface that does not port as a material swap: its
   *  13 per-instance attributes exceed WebGPU's 8 vertex buffers, so it
   *  carries its own packed geometry over the field's live arrays.
   *  `mirrorParent` takes the local-pass mirror draw — the field's
   *  `localGroup`, which the solar-system cluster parents into the pass
   *  scene. */
  attachPlanetGlare(
    sources: PlanetGlareSources,
    mirrorParent: THREE.Object3D,
  ): WebGpuPlanetGlare;
}

export interface WebGpuPlanetGlare {
  /** Chart mode's flat-ink blend — the swap `PlanetBodyField` applies to
   *  its own material. */
  setMonochrome(on: boolean): void;
  /** The field's group-visibility gate, which has no group to ride here. */
  setVisible(on: boolean): void;
  dispose(): void;
}

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
import type {
  SolarSystemMaterials,
} from '../solar-system/materials/emitter-material';
import type { SharedUniformNodes } from './shared-uniform-nodes';
import type { StarGeometrySources } from './star/star-geometry';

export type StellataRenderer = THREE.WebGLRenderer | WebGPURenderer;

export type { StarGeometrySources } from './star/star-geometry';

export interface WebGpuStarLayer {
  /** The shell's per-frame CPU gate on the depth-only core-mask draw —
   *  the same `visible` flip it applies to the WebGL mesh. */
  setCoreMaskVisible(on: boolean): void;
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
  /** Whether the adapter granted `timestamp-query`. `trackTimestamp: true`
   *  is a request: three clears it silently when the feature is absent, so
   *  every GPU-timing consumer must ask here rather than assume. */
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
  /** The TSL planet surfaces, over the caller's 1×1 placeholder — the
   *  mesh layer owns that texture on either backend, so the factory takes
   *  it rather than the other way round. */
  solarSystemMaterials(placeholder: THREE.Texture): SolarSystemMaterials;
  /** The TSL probe glyph, which reads no texture and so needs no
   *  placeholder — the split mirrors `makeGlslProbeMaterial`. */
  readonly probeMaterial: Pick<SolarSystemMaterials, 'probeMarker'>;
  /** Build the TSL reflected-glare billboard into the seam's scene. The
   *  one solar-system surface that does not port as a material swap: its
   *  13 per-instance attributes exceed WebGPU's 8 vertex buffers, so it
   *  carries its own packed geometry over the field's live arrays. */
  attachPlanetGlare(sources: PlanetGlareSources): WebGpuPlanetGlare;
}

export interface WebGpuPlanetGlare {
  /** Chart mode's flat-ink blend — the swap `PlanetBodyField` applies to
   *  its own material. */
  setMonochrome(on: boolean): void;
  /** The field's group-visibility gate, which has no group to ride here. */
  setVisible(on: boolean): void;
  dispose(): void;
}

// The backend-neutral shape of the HDR seam and its reduction. WebGL:
// ./hdr-pipeline.ts + exposure/reduction/; WebGPU: ../webgpu/hdr/,
// behind the import boundary.

import type * as THREE from 'three';
import type { HdrEmitterUniforms } from './hdr-pipeline';
import type { TileReduction } from './exposure/reduction/reduction-pure';

/** One frame's reduced statistic. The two luminance channels are still in
 *  the exposure the frame was RENDERED with — `rescaleToBaseExposure` is
 *  the caller's step. `coverage` is a fraction and needs no rescale. */
export interface ReducedStatistic extends TileReduction {
  renderExposure: number;
}

export interface HdrSeam {
  /** WebGL2: whether a float-renderable colour buffer exists. WebGPU:
   *  always true — float targets are core (README.md § Fallback). */
  readonly supported: boolean;
  readonly emitterUniforms: HdrEmitterUniforms;
  bind(): void;
  resolve(): void;
  statisticTexture(): THREE.Texture | null;
  setPixelSolidAngle(pxPerRadian: number): void;
  syncSize(): void;
  setChartMode(on: boolean): void;
  setDynamicRangeMag(drMag: number): void;
  getDynamicRangeMag(): number;
  setHighlightDesat(desat: number): void;
  getHighlightDesat(): number;
  setTonemapEnabled(on: boolean): void;
  setStatisticWritesEnabled(on: boolean): void;
  setStatisticWritesParked(on: boolean): void;
  setSummationEnabled(on: boolean): void;
  setSummationTapsEnabled(on: boolean): void;
  setExtraAttachmentsEnabled(on: boolean): void;
  dispose(): void;
}

/** The reduction the adaptation loop and the frame-cost levers drive —
 *  exposure/reduction/README.md owns the semantics of every member. */
export interface ReductionSeam {
  enabled: boolean;
  fenceWhileParked: boolean;
  readonly readbackRequests: number;
  readonly readbackPending: boolean;
  measure(
    source: THREE.Texture | null,
    width: number,
    height: number,
    renderExposure: number,
    parked: boolean,
  ): void;
  current(): ReducedStatistic | null;
  reset(): void;
  dispose(): void;
}

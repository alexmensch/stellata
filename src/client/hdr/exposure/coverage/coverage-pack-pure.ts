// The coverage round trip's bookkeeping: source texels out, throughput
// keys back, ring slots and their unused-slot sentinel. Split from the
// pass because none of it needs a GL context. Contract in README.md.

import type * as THREE from 'three';
import { footprintRadiusPx } from '../scene-adaptation-pure';
import { COVERAGE_MAX_SOURCES } from './coverage-pure';

/** What the measurement needs of a light source — a structural subset of
 *  `LuminanceSample`, so the walk's own pool satisfies it unchanged. */
export interface CoverageSource {
  readonly sourceKey: number;
  readonly screenX: number;
  readonly screenY: number;
  readonly diameterPx: number;
  readonly cameraDistancePc: number;
}

/** One ring annulus drawn this frame, in **view space**. Filled from a
 *  scratch object owned by the producer and valid only inside one `visit`
 *  call — read it, don't retain it. */
export interface RingOccluder {
  centreView: THREE.Vector3;
  poleView: THREE.Vector3;
  outerPc: number;
  innerRatio: number;
  /** Crossfade weight on the strip's authored alpha, so the extinction
   *  tracks the alpha actually composited. */
  alphaScale: number;
  strip: THREE.Texture;
}

/** Ring annuli drawn this frame. Implemented by `PlanetMeshLayer`. */
export interface CoverageRingSources {
  forEachRingOccluder(
    camera: THREE.PerspectiveCamera,
    visit: (ring: RingOccluder) => void,
  ): void;
}

/** Sources the target has texels for this frame. A frame past the cap
 *  leaves its excess unmeasured, which reads as unoccluded. */
export function measuredSourceCount(count: number): number {
  return Math.min(Math.max(count, 0), COVERAGE_MAX_SOURCES);
}

/**
 * Pack `n` sources into the RGBA32F source row and record their keys at
 * the matching indices. `keys[i]` and texel `i` describe the same source,
 * which is the whole correspondence the readback is filed under — the
 * measurement lands after the pool that produced it is gone.
 */
export function packSourceTexels(
  sources: readonly CoverageSource[],
  n: number,
  texels: Float32Array,
  keys: Int32Array,
): void {
  for (let i = 0; i < n; i++) {
    const s = sources[i];
    const o = i * 4;
    texels[o] = s.screenX;
    texels[o + 1] = s.screenY;
    texels[o + 2] = footprintRadiusPx(s.diameterPx);
    texels[o + 3] = s.cameraDistancePc;
    keys[i] = s.sourceKey;
  }
}

/**
 * File a completed readback under the keys the frame that issued it
 * wrote. `pixels` is RGBA and the throughput is the red channel; pool
 * order would hand one source another's answer the moment a body left
 * the frame, which is why this reads `keys` and not an index.
 */
export function landTransmission(
  keys: Int32Array,
  pixels: Float32Array,
  count: number,
  out: Map<number, number>,
): void {
  out.clear();
  for (let i = 0; i < count; i++) out.set(keys[i], pixels[i * 4]);
}

/** `xyz` = annulus centre / unit pole, `w` = outer radius pc / inner:outer
 *  ratio — the layout `coverage.frag.glsl` unpacks. */
export function packRingSlot(
  ring: RingOccluder,
  centre: THREE.Vector4,
  pole: THREE.Vector4,
): void {
  const c = ring.centreView;
  const p = ring.poleView;
  centre.set(c.x, c.y, c.z, ring.outerPc);
  pole.set(p.x, p.y, p.z, ring.innerRatio);
}

/** A zero outer radius is the shader's unused-slot sentinel; the pole
 *  stays unit so a stale slot can never divide by zero. */
export function clearRingSlot(centre: THREE.Vector4, pole: THREE.Vector4): void {
  centre.set(0, 0, 0, 0);
  pole.set(0, 0, 1, 0);
}

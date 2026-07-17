// SceneLayer contract + registry: one registration per render layer
// replaces the shell's hand-maintained per-layer update / monochrome /
// recenter / dispose enumerations. See README.md.

import type * as THREE from 'three';

/** Per-frame inputs shared by every layer, computed ONCE per frame by
 *  the integration shell. Layers keep their own visibility gates
 *  internally (including how they behave while a warp is in flight). */
export interface FrameCtx {
  readonly camera: THREE.PerspectiveCamera;
  readonly worldOffset: Readonly<THREE.Vector3>;
  /** Camera distance from Sol in absolute ICRS pc (float64 sum). */
  readonly distFromSol: number;
  /** Model clock (Unix seconds) — Stellata.getT() snapshot. */
  readonly t: number;
  readonly warpActive: boolean;
}

/** One scene layer's per-frame + lifecycle hooks. Every hook except
 *  dispose is optional — a layer registers only the fan-outs it
 *  participates in, and registration guarantees inclusion in each. */
export interface SceneLayer {
  update?(ctx: FrameCtx): void;
  setMonochrome?(on: boolean): void;
  /** Floating-origin recentre — layers holding local-frame positions
   *  re-derive them against the new origin. */
  recenter?(newOrigin: Readonly<THREE.Vector3>): void;
  dispose(): void;
}

/** Ordered layer collection. update runs in registration order —
 *  register in draw-dependency order (continuously-ticking layers
 *  first, SVG projectors after the camera-matrix refresh they need). */
export class SceneLayerRegistry {
  private readonly layers: SceneLayer[] = [];

  register(layer: SceneLayer): void {
    this.layers.push(layer);
  }

  updateAll(ctx: FrameCtx): void {
    for (const layer of this.layers) layer.update?.(ctx);
  }

  setMonochromeAll(on: boolean): void {
    for (const layer of this.layers) layer.setMonochrome?.(on);
  }

  recenterAll(newOrigin: Readonly<THREE.Vector3>): void {
    for (const layer of this.layers) layer.recenter?.(newOrigin);
  }

  disposeAll(): void {
    for (const layer of this.layers) layer.dispose();
  }
}

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
  /** CSS pixels per radian for the live viewport/FOV — what converts a
   *  layer's angular motion rate to the screen-pixel budget the clock
   *  cadence runs on (../render-gate/README.md § The clock cadence). */
  readonly pxPerRadian: number;
}

/** One scene layer's per-frame + lifecycle hooks. Every hook except
 *  dispose is optional — a layer registers only the fan-outs it
 *  participates in, and registration guarantees inclusion in each. */
export interface SceneLayer {
  update?(ctx: FrameCtx): void;
  /** Largest sim-time step (seconds) this layer's drawn content can
   *  absorb without visible change — how long the render gate may idle
   *  under a running clock. Called after every `update` fan-out; a layer
   *  whose content the sim clock moves on screen MUST implement it, or
   *  its motion freezes between cadence frames
   *  (../render-gate/README.md § The clock cadence). Omit (or return
   *  Infinity) when nothing drawn rides the clock. */
  cadenceSimBudgetS?(ctx: FrameCtx): number;
  setMonochrome?(on: boolean): void;
  /** Floating-origin recentre — layers holding local-frame positions
   *  re-derive them against the new origin. */
  recenter?(newOrigin: Readonly<THREE.Vector3>): void;
  dispose(): void;
}

/** Per-frame update body shared by the warp-gated reference layers
 *  (galactic disc, constellation boundaries, LG wireframe): hidden
 *  during warp or when the declutter floor forbids, else distance-faded
 *  by the layer's own update. Null layer → no-op so a lazily-attached
 *  layer registers unconditionally. */
export function updateWarpGatedRefLayer(
  layer: {
    group: { visible: boolean };
    update: (worldOffset: Readonly<THREE.Vector3>, distFromSol: number) => void;
  } | null,
  ctx: FrameCtx,
  permitted: boolean,
): void {
  if (!layer) return;
  if (ctx.warpActive || !permitted) {
    layer.group.visible = false;
    return;
  }
  layer.update(ctx.worldOffset, ctx.distFromSol);
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

  /** Min over every layer's cadence budget for this frame — Infinity when
   *  no layer constrains it. Run after `updateAll`, so each budget reads
   *  the state its own update just wrote. */
  minCadenceBudgetS(ctx: FrameCtx): number {
    let min = Number.POSITIVE_INFINITY;
    for (const layer of this.layers) {
      const budget = layer.cadenceSimBudgetS?.(ctx);
      if (budget !== undefined && budget < min) min = budget;
    }
    return min;
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

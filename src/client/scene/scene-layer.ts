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
  /** Device pixels per CSS pixel (`uPixelRatio`). The cadence threshold
   *  is stated in device pixels, so a CSS-px rate needs this to reach
   *  it — `cadenceBudgetFromRatePxS` takes both. */
  readonly pixelRatio: number;
}

/** How the passage of time changes what a layer draws.
 *
 *  REQUIRED on every layer, and a discriminated union rather than an
 *  optional budget, because the failure being prevented is **silence**: an
 *  omitted hook reads as "nothing I draw moves", and a layer that does
 *  move then freezes between the render gate's cadence frames — the worst
 *  failure mode arrived at by doing nothing. A new layer cannot compile
 *  without answering, and every answer is a claim reviewable on its own
 *  terms rather than an absence nobody can see.
 *
 *  Enforced by the type, not by a test: a test can only check the layers
 *  that exist when it is written. */
export type LayerTimeBehaviour =
  /** Nothing this layer draws changes as either clock advances. It still
   *  repaints on an explicit `renderGate.invalidate(reason)` — this is a
   *  claim about TIME, not about being immutable. */
  | { readonly kind: 'static' }
  /** Content moves as SIM time advances. `budgetSimS` returns the largest
   *  sim-time step that cannot move anything it draws past the render
   *  gate's motion threshold, or Infinity when nothing is drawn right now
   *  (`../render-gate/README.md` § The clock cadence). Conservative is
   *  correct; too large freezes the layer between cadence frames. */
  | { readonly kind: 'clock'; budgetSimS(ctx: FrameCtx): number }
  /** Animates on WALL-CLOCK time, so it needs real frames even with the
   *  sim clock paused — which no sim-time budget can express.
   *
   *  **This kind defeats idling for as long as `needsFrames` is true**, so
   *  it is a last resort and the predicate must be as narrow as the layer
   *  can make it. Prefer converging over a count of RENDERED FRAMES
   *  instead: an N-frame blend looks the same at 60 Hz and at one frame
   *  per 30 s, and declares `'static'`. Grep this kind before adding one —
   *  the goal is zero users. */
  | { readonly kind: 'realtime'; needsFrames(ctx: FrameCtx): boolean };

/** One scene layer's per-frame + lifecycle hooks. Every hook except
 *  dispose is optional — a layer registers only the fan-outs it
 *  participates in, and registration guarantees inclusion in each. */
export interface SceneLayer {
  /** Required. See `LayerTimeBehaviour` — omitting it is the bug the
   *  union exists to make impossible. */
  readonly timeBehaviour: LayerTimeBehaviour;
  update?(ctx: FrameCtx): void;
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

  /** Min over every `'clock'` layer's budget for this frame — Infinity
   *  when none constrains it. Run after `updateAll`, so each budget reads
   *  the state its own update just wrote. A NaN budget cannot win: `<`
   *  is false against it, so a layer returning garbage cannot freeze the
   *  clock for every other layer. */
  minCadenceBudgetS(ctx: FrameCtx): number {
    let min = Number.POSITIVE_INFINITY;
    for (const layer of this.layers) {
      if (layer.timeBehaviour.kind !== 'clock') continue;
      const budget = layer.timeBehaviour.budgetSimS(ctx);
      if (budget < min) min = budget;
    }
    return min;
  }

  /** Whether any `'realtime'` layer needs wall-clock frames right now.
   *  True defeats idling entirely, which is why the kind is a last resort
   *  and this is worth reading in the render watcher. */
  realtimeFramesNeeded(ctx: FrameCtx): boolean {
    for (const layer of this.layers) {
      if (layer.timeBehaviour.kind === 'realtime'
        && layer.timeBehaviour.needsFrames(ctx)) return true;
    }
    return false;
  }

  /** Count of layers per declared behaviour — the audit surface. A rising
   *  `realtime` count is a regression whatever else is green. */
  behaviourCensus(): Record<LayerTimeBehaviour['kind'], number> {
    const out = { static: 0, clock: 0, realtime: 0 };
    for (const layer of this.layers) out[layer.timeBehaviour.kind]++;
    return out;
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

// SceneLayer contract + registry: one registration per render layer
// replaces the shell's hand-maintained per-layer update / monochrome /
// recenter / dispose enumerations. See README.md.

import type * as THREE from 'three';
import {
  CADENCE_REPORT_STILL,
  maxCadenceReport,
  type CadenceReport,
} from '../render-gate/cadence/clock-cadence-pure';

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

/** Inputs a `'clock'` layer's rate report reads. Built AFTER the per-frame
 *  fan-out, so every position it divides by is this frame's.
 *
 *  Deliberately has no pixel ratio and no threshold: layers report rates
 *  in CSS px per sim second and the gate converts once
 *  (`../render-gate/cadence/clock-cadence-pure.ts` `cadenceSimBudgetS`). A layer
 *  that could reach the device-pixel threshold itself would be a second
 *  place for it to drift. */
export interface CadenceCtx {
  readonly camera: THREE.PerspectiveCamera;
  /** Monotonic rendered-frame counter. Several registry entries can draw
   *  views of ONE subsystem's content — a moon's orbit ring is centred on
   *  the moon's parent, the star cluster mirrors slots the binary walk
   *  wrote — and each must declare a rate rather than stay silent. They
   *  declare the rate of the subsystem whose content they are anchored to,
   *  and the field caches on this token so its walk runs once per frame
   *  however many entries ask (README.md § Anchored content). */
  readonly frameId: number;
  /** CSS pixels per radian at the live viewport / FOV — the plate scale
   *  that turns an angular rate into an on-screen one. */
  readonly pxPerRadian: number;
  /** Sim seconds since the last rendered frame; NaN before the first.
   *  The interval every difference in a report is taken over. */
  readonly simDtS: number;
  /** The camera's OWN velocity in the local frame, pc per sim second —
   *  the focal ride's applied delta over `simDtS`, zero when no ride
   *  moved the camera this frame.
   *
   *  Layers SUBTRACT it rather than bounding it. The ride translates the
   *  camera by exactly the focal's displacement over this interval, and a
   *  body differencing its own position over the same interval therefore
   *  cancels it exactly — which is why the ridden focal contributes only
   *  its own rotation, and why no ride-specific fudge factor exists
   *  (`../render-gate/README.md` § The focal ride). */
  readonly cameraVelPcPerSimS: Readonly<THREE.Vector3>;
}

/** How the passage of time changes what a layer draws.
 *
 *  REQUIRED on every layer, and a discriminated union rather than an
 *  optional hook, because the failure being prevented is **silence**: an
 *  omitted hook reads as "nothing I draw moves", and a layer that does
 *  move then freezes between the render gate's cadence frames — the worst
 *  failure mode arrived at by doing nothing. A new layer cannot compile
 *  without answering, and every answer is a claim reviewable on its own
 *  terms rather than an absence nobody can see.
 *
 *  Enforced by the type, not by a test: a test can only check the layers
 *  that exist when it is written. What `tests/cadence-layer-declarations.
 *  test.ts` adds is the count of `'realtime'` declarations, which is a
 *  property of the shipped registry and has to be scanned for. */
export type LayerTimeBehaviour =
  /** Nothing this layer draws changes as either clock advances. It still
   *  repaints on an explicit `renderGate.invalidate(reason)` — this is a
   *  claim about TIME, not about being immutable. */
  | { readonly kind: 'static' }
  /** Content changes as SIM time advances. `rate` reports how fast, per
   *  sim second, for what the layer is drawing RIGHT NOW — see
   *  `CadenceReport`. */
  | { readonly kind: 'clock'; rate(ctx: CadenceCtx): CadenceReport }
  /** Animates on WALL-CLOCK time, so it needs real frames even with the
   *  sim clock paused — which no sim-time rate can express.
   *
   *  **This kind defeats idling for as long as `needsFrames` is true**, so
   *  it is a last resort and the predicate must be as narrow as the layer
   *  can make it. Prefer converging over a count of RENDERED FRAMES
   *  instead: an N-frame blend looks the same at 60 Hz and at one frame
   *  per 30 s, and declares `'static'`.
   *
   *  The predicate is evaluated ABOVE the gate, on every tick, so a layer
   *  that starts needing wall-clock frames gets them on the next tick
   *  rather than after one cap — and gets them at all with the clock
   *  paused, which fires no cadence frame to be read on.
   *
   *  There are ZERO users, and `tests/cadence-layer-declarations.test.ts`
   *  pins that at zero. */
  | { readonly kind: 'realtime'; needsFrames(ctx: FrameCtx): boolean };

/** One scene layer's per-frame + lifecycle hooks. Every hook except
 *  `dispose` and `timeBehaviour` is optional — a layer registers only the
 *  fan-outs it participates in, and registration guarantees inclusion in
 *  each. */
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

  /** Channel-wise fastest report over every `'clock'` layer — the frame's
   *  single rate, which the gate turns into one budget. Run AFTER
   *  `updateAll`, so each report reads the state its own update just
   *  wrote, and after the focal ride, so `ctx.cameraVelPcPerSimS` is this
   *  frame's.
   *
   *  A NaN rate cannot win: `maxCadenceReport` compares rather than
   *  calling `Math.max`, so a layer returning garbage cannot freeze the
   *  clock for every other layer. */
  cadenceReport(ctx: CadenceCtx): CadenceReport {
    let out = CADENCE_REPORT_STILL;
    for (const layer of this.layers) {
      if (layer.timeBehaviour.kind !== 'clock') continue;
      out = maxCadenceReport(out, layer.timeBehaviour.rate(ctx));
    }
    return out;
  }

  /** Whether any `'realtime'` layer needs wall-clock frames right now.
   *  True defeats idling entirely, which is why the kind is a last resort
   *  and this is worth reading in the render watcher. Evaluated above the
   *  gate — see `LayerTimeBehaviour`. */
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

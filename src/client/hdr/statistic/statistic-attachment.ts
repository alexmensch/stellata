// The per-draw gate on the target's statistic attachment. See README.md
// § The gate.

import type * as THREE from 'three';

let openGate: (() => void) | null = null;
let closeGate: (() => void) | null = null;

/** `HdrPipeline` owns the GL context, so it supplies the two calls; every
 *  emitter binds to them through `markStatisticEmitter`. Null while no
 *  target exists, which is what makes the seam inert under the fallback
 *  path and in chart mode. */
export function bindStatisticGate(
  open: (() => void) | null,
  close: (() => void) | null,
): void {
  openGate = open;
  closeGate = close;
}

/**
 * Declare a mesh a **physical** emitter: its draw lands in attachment 1
 * as well as attachment 0. Nothing else does, so an authored-colour
 * chrome layer cannot reach the statistic — including one added later,
 * which is the point of gating the emitters rather than the chrome.
 *
 * Composes with whatever hooks the object already carries (three seeds
 * both with no-ops), so call order never decides whose survive.
 */
export function markStatisticEmitter(object: THREE.Object3D): void {
  const before = object.onBeforeRender;
  const after = object.onAfterRender;
  object.onBeforeRender = (...args) => {
    openGate?.();
    before.apply(object, args);
  };
  object.onAfterRender = (...args) => {
    after.apply(object, args);
    closeGate?.();
  };
}

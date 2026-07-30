// The per-draw gate on the target's statistic attachment. See README.md
// § Statistic attachment.

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
 * Takes over the object's render hooks; a mesh that needs its own must
 * compose them here rather than assigning over these.
 */
export function markStatisticEmitter(object: THREE.Object3D): void {
  object.onBeforeRender = () => openGate?.();
  object.onAfterRender = () => closeGate?.();
}

// The per-draw gate on the target's attachments past 0 — one mark per role.
// See README.md § The gate.

import type * as THREE from 'three';

/** Which set of the target's attachments a draw may write. Attachment 0 is
 *  the only one open at rest; a volumetric emitter and an absorber both
 *  reach attachment 2, because that is where the diffuse field lives until
 *  the resolve convolves it (`../summation/README.md`). */
export type GatedAttachments = 'statistic' | 'diffuse' | 'absorption';

let openGate: ((attachments: GatedAttachments) => void) | null = null;
let closeGate: (() => void) | null = null;

/** `HdrPipeline` owns the GL context, so it supplies the two calls; every
 *  marked mesh binds to them through the three `mark*` helpers. Null while
 *  no target exists, which is what makes the seam inert under the fallback
 *  path and in chart mode. */
export function bindAttachmentGate(
  open: ((attachments: GatedAttachments) => void) | null,
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
  markEmitter(object, 'statistic');
}

/**
 * Declare a mesh a **volumetric** emitter: attachment 2 opens too, and
 * attachment 0 does not — the resolve owns that write once it has averaged
 * attachment 2 over the summation patch.
 *
 * A shader that declares `location = 2` and a draw that does not open it are
 * both silent failures — the write is discarded in one direction, and in the
 * other every non-diffuse draw leaves attachment 2 undefined. So the mark and
 * the `out` declaration are one contract.
 */
export function markDiffuseEmitter(object: THREE.Object3D): void {
  markEmitter(object, 'diffuse');
}

/**
 * Declare a mesh an **absorber**: its blend has to reach attachment 2 as
 * well as attachment 0, because the light it dims — the band, the Local
 * Group glow — is in attachment 2 now. Attachment 1 stays shut, so the
 * statistic keeps reading un-extincted light (README.md § Known residuals).
 *
 * The statistic gate's default is safe because a draw that forgets it merely
 * fails to *contribute*. This one inverts: an absorber that forgets the mark
 * silently stops absorbing, which looks like a missing dark rift rather than
 * an error. `molecular-clouds.test.ts` pins the only call site.
 */
export function markAbsorber(object: THREE.Object3D): void {
  markEmitter(object, 'absorption');
}

function markEmitter(object: THREE.Object3D, attachments: GatedAttachments): void {
  const before = object.onBeforeRender;
  const after = object.onAfterRender;
  object.onBeforeRender = (...args) => {
    openGate?.(attachments);
    before.apply(object, args);
  };
  object.onAfterRender = (...args) => {
    after.apply(object, args);
    closeGate?.();
  };
}

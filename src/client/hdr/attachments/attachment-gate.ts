// The per-draw gate on the target's attachments past 0 — one mark per role.
// See README.md § The gate.

import type * as THREE from 'three';

/** Which set of the target's attachments a draw may write. Attachment 0 is
 *  the only one open at rest; every set that reaches attachment 2 does so
 *  because that is where the diffuse field lives until the resolve convolves
 *  it (`../summation/README.md`). */
export type GatedAttachments =
  | 'statistic'
  | 'diffuse'
  | 'absorption'
  | 'occluding-emitter';

/** The two non-mark states the gate also passes through: the all-open clear
 *  and the attachment-0-only rest. */
export type GateState = GatedAttachments | 'clear' | 'rest';

/** The frame-cost levers that mask slots out of every state
 *  (`../README.md` § Dev switches). */
export interface GateSlotOptions {
  /** False masks attachment 1 out of every draw while the clear keeps
   *  writing it, so the statistic attachment reads zero rather than stale. */
  statisticWrites: boolean;
  /** False masks attachments 1 and 2 everywhere, the clear included —
   *  the single-attachment target has nothing behind either slot. */
  extraAttachments: boolean;
}

const GATE_SLOT_TABLE: Record<GateState, readonly [boolean, boolean, boolean]> = {
  statistic: [true, true, false],
  diffuse: [false, true, true],
  absorption: [true, false, true],
  'occluding-emitter': [true, true, true],
  clear: [true, true, true],
  rest: [true, false, false],
};

/** Which of the target's three attachments a `drawBuffers` write opens for
 *  the given state, with the frame-cost masks applied. */
export function gateDrawSlots(
  state: GateState,
  options: GateSlotOptions,
): readonly [boolean, boolean, boolean] {
  const [display, statistic, diffuse] = GATE_SLOT_TABLE[state];
  return [
    display,
    statistic &&
      options.extraAttachments &&
      (options.statisticWrites || state === 'clear'),
    diffuse && options.extraAttachments,
  ];
}

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

/**
 * Declare a mesh an emitter that **also stands in front of the diffuse
 * field**: every attachment opens, because it emits into 0, measures into 1,
 * and has to dim 2 by its own opacity.
 *
 * This is the mark for any alpha-compositing draw ordered after the
 * volumetric emitters — the planet mesh, its ring annulus, its atmosphere
 * shell. Leaving the diffuse field out of their blend chain is what let the
 * band be added back on top of a planet's night side; the depth buffer cannot
 * help, because the emitters drew first and the resolve adds attachment 2
 * unconditionally. Same inverted safety as `markAbsorber`: forget it and the
 * object silently stops occluding.
 *
 * The shader's `stellataOccluderTexel` alpha and this mark are one contract —
 * `planet-mesh-layer.test.ts` pins both halves.
 */
export function markOccludingEmitter(object: THREE.Object3D): void {
  markEmitter(object, 'occluding-emitter');
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

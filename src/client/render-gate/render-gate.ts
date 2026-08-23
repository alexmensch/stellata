// RenderGate — decides each rAF tick whether the frame gets drawn.
// Invalidation sources, holds, and the settle tail: README.md.

import type * as THREE from 'three';
import {
  POSE_SLOTS, SETTLE_MS, decideRender, firstDifferingPoseSlot, posesDiffer,
  rebasePoseTranslation, writePose,
} from './render-gate-pure';

const CANVAS_WAKE_EVENTS = [
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'wheel',
] as const;

export interface GateWake {
  readonly reason: string;
  readonly atMs: number;
}

export interface GateDecisionTrace {
  readonly continuous: boolean;
  readonly poseChanged: boolean;
  readonly cadenceDue: boolean;
  readonly poseSlot: string | null;
}

export class RenderGate {
  private holds = 0;
  private lastActiveMs = Number.NEGATIVE_INFINITY;
  private readonly lastRenderedPose = new Float64Array(POSE_SLOTS).fill(Number.NaN);
  private readonly scratchPose = new Float64Array(POSE_SLOTS);
  private detachDom: (() => void) | null = null;

  private lastWake: GateWake | null = null;
  private lastDecision: GateDecisionTrace | null = null;
  private lastCadenceScheduled = false;

  /** Was the frame just drawn scheduled by the CLOCK CADENCE alone — no
   *  hold, no continuous condition, no camera move, no settle tail? Only
   *  then does what moved between the two frames say anything about the
   *  budget, which is why the safety net reads this rather than
   *  `cadenceDue` (true on plenty of frames the gate would have drawn
   *  anyway). */
  get lastFrameWasCadenceScheduled(): boolean {
    return this.lastCadenceScheduled;
  }

  /** Debug-scoped view of what the gate decided and why, for the render
   *  watcher (`../debug/render-watch/README.md`). Read-only — a caller
   *  that wants frames calls `invalidate()` or `hold()`.
   *
   *  `lastWake` is the most recent `invalidate()` and its reason;
   *  `lastDecision` is the last tick's inputs, with `poseSlot` naming the
   *  first pose slot that moved. Between them they answer "what woke it",
   *  which the activity stamp alone cannot: every source collapses into
   *  one timestamp by the time anything reads it. */
  get debugState(): {
    holds: number;
    lastActiveMs: number;
    lastWake: GateWake | null;
    lastDecision: GateDecisionTrace | null;
  } {
    return {
      holds: this.holds,
      lastActiveMs: this.lastActiveMs,
      lastWake: this.lastWake,
      lastDecision: this.lastDecision,
    };
  }

  /** Request frames for the settle tail — call on any mutation the pose
   *  snapshot and the continuous conditions cannot see.
   *
   *  `reason` is required because a wake is otherwise untraceable: every
   *  source writes the same timestamp, so a frame rate pinned by one of a
   *  dozen callers cannot be attributed after the fact. Keep it a short
   *  stable slug — the watcher prints it verbatim. */
  invalidate(reason: string): void {
    this.lastActiveMs = performance.now();
    this.lastWake = { reason, atMs: this.lastActiveMs };
  }

  /** Render every frame until the returned release runs (ref-counted;
   *  release is idempotent). For per-frame instruments: the debug panel
   *  and the frame-cost harness. */
  hold(): () => void {
    this.holds++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      // Floored, not decremented: dispose() zeroes the count while a
      // hold can still be outstanding (the debug panel outlives the
      // shell), and a negative count makes the NEXT hold a no-op.
      this.holds = Math.max(0, this.holds - 1);
    };
  }

  /** Absorb a camera+target translation applied after this frame's
   *  `tick()` — the focal ride, which keeps the focused object at the
   *  same screen position and so changes nothing the viewer can see.
   *
   *  Without this a moving focus can never idle, and not for the reason
   *  it looks like: the ride runs below the gate, so the NEXT tick reads
   *  its write as a fresh camera move, renders, rides again, and stamps
   *  activity every tick forever. Absorbing it hands the schedule to the
   *  clock cadence, which is the only thing that can price what the
   *  translation actually moves — the parallax on everything that is not
   *  the focal, which every layer now differences against the ride's own
   *  velocity (README.md § The focal ride). */
  rebasePose(delta: { x: number; y: number; z: number }): void {
    rebasePoseTranslation(this.lastRenderedPose, delta.x, delta.y, delta.z);
  }

  /** Wake on canvas pointer/wheel input and window keydown, so hover,
   *  drags, and shortcuts repaint within one tick. */
  attachDom(canvas: HTMLElement): void {
    const wakes = new Map<string, () => void>();
    for (const name of CANVAS_WAKE_EVENTS) {
      const wake = () => this.invalidate(`dom:${name}`);
      wakes.set(name, wake);
      canvas.addEventListener(name, wake, { passive: true });
    }
    const keyWake = () => this.invalidate('dom:keydown');
    window.addEventListener('keydown', keyWake);
    this.detachDom = () => {
      for (const name of CANVAS_WAKE_EVENTS) canvas.removeEventListener(name, wakes.get(name)!);
      window.removeEventListener('keydown', keyWake);
    };
  }

  /** Per-tick decision. The pose snapshot advances only on rendered
   *  frames, so change accumulating across skipped ticks still triggers. */
  tick(
    camera: THREE.PerspectiveCamera,
    target: THREE.Vector3,
    worldOffset: THREE.Vector3,
    inputs: { continuous: boolean; cadenceDue: boolean; nowMs: number },
  ): boolean {
    writePose(
      this.scratchPose, camera.position, camera.quaternion, camera.fov,
      target, worldOffset,
    );
    const poseChanged = posesDiffer(this.scratchPose, this.lastRenderedPose);
    const decision = decideRender(
      { holds: this.holds, lastActiveMs: this.lastActiveMs },
      {
        continuous: inputs.continuous,
        poseChanged,
        cadenceDue: inputs.cadenceDue,
        nowMs: inputs.nowMs,
      },
    );
    this.lastDecision = {
      continuous: inputs.continuous,
      poseChanged,
      cadenceDue: inputs.cadenceDue,
      // Only when it changed — the scan is for diagnosis, not the hot path.
      poseSlot: poseChanged
        ? firstDifferingPoseSlot(this.scratchPose, this.lastRenderedPose) : null,
    };
    this.lastCadenceScheduled = decision.render
      && inputs.cadenceDue
      && this.holds === 0
      && !inputs.continuous
      && !poseChanged
      && inputs.nowMs - decision.lastActiveMs >= SETTLE_MS;
    this.lastActiveMs = decision.lastActiveMs;
    if (decision.render) this.lastRenderedPose.set(this.scratchPose);
    return decision.render;
  }

  dispose(): void {
    this.detachDom?.();
    this.detachDom = null;
    this.holds = 0;
    this.lastActiveMs = Number.NEGATIVE_INFINITY;
    this.lastRenderedPose.fill(Number.NaN);
    this.lastWake = null;
    this.lastDecision = null;
    this.lastCadenceScheduled = false;
  }
}

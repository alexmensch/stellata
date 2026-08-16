// RenderGate — decides each rAF tick whether the frame gets drawn.
// Invalidation sources, holds, and the settle tail: README.md.

import type * as THREE from 'three';
import { POSE_SLOTS, decideRender, posesDiffer, writePose } from './render-gate-pure';

const CANVAS_WAKE_EVENTS = [
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'wheel',
] as const;

export class RenderGate {
  private holds = 0;
  private lastActiveMs = Number.NEGATIVE_INFINITY;
  private readonly lastRenderedPose = new Float64Array(POSE_SLOTS).fill(Number.NaN);
  private readonly scratchPose = new Float64Array(POSE_SLOTS);
  private detachDom: (() => void) | null = null;

  /** Request frames for the settle tail — call on any mutation the pose
   *  snapshot and the continuous conditions cannot see. */
  invalidate(): void {
    this.lastActiveMs = performance.now();
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
      this.holds--;
    };
  }

  /** Wake on canvas pointer/wheel input and window keydown, so hover,
   *  drags, and shortcuts repaint within one tick. */
  attachDom(canvas: HTMLElement): void {
    const wake = () => this.invalidate();
    for (const name of CANVAS_WAKE_EVENTS) {
      canvas.addEventListener(name, wake, { passive: true });
    }
    window.addEventListener('keydown', wake);
    this.detachDom = () => {
      for (const name of CANVAS_WAKE_EVENTS) canvas.removeEventListener(name, wake);
      window.removeEventListener('keydown', wake);
    };
  }

  /** Per-tick decision. The pose snapshot advances only on rendered
   *  frames, so change accumulating across skipped ticks still triggers. */
  tick(
    camera: THREE.PerspectiveCamera,
    target: THREE.Vector3,
    worldOffset: THREE.Vector3,
    continuous: boolean,
    nowMs: number,
  ): boolean {
    writePose(
      this.scratchPose, camera.position, camera.quaternion, camera.fov,
      target, worldOffset,
    );
    const decision = decideRender(
      { holds: this.holds, lastActiveMs: this.lastActiveMs },
      {
        continuous,
        poseChanged: posesDiffer(this.scratchPose, this.lastRenderedPose),
        nowMs,
      },
    );
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
  }
}

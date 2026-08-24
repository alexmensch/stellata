// Stops TrackballControls' damping tail under a pixel-scale floor, and
// holds the pose it re-derives still when nothing moved. See README.md
// § Damping settle floor and § Derived-pose settle floor.

import * as THREE from 'three';
import type { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import {
  TRACKBALL_SETTLE_PX, trackballMotionPx, orientationHeldStill, positionHeldStill,
} from './trackball-settle-pure';

const WAKE_EVENTS = ['pointerdown', 'wheel'] as const;

export class TrackballSettle {
  private readonly controls: TrackballControls;
  private readonly prevEye = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  // The pose as it stood before `update()` re-derived it. Restoring these
  // bits makes the camera its own anchor, so a sub-floor step is not
  // forgiven afresh against a reference that already absorbed the last one.
  private readonly prePos = new THREE.Vector3();
  private readonly preQuat = new THREE.Quaternion();
  private captured = false;
  private seeded = false;
  private detachDom: (() => void) | null = null;

  constructor(controls: TrackballControls) {
    this.controls = controls;
  }

  /** Hand the damping back before a gesture's first `update()`, which
   *  lands ahead of any motion this could measure — a wheel notch would
   *  otherwise apply whole while the tail is still frozen. */
  attachDom(canvas: HTMLElement): void {
    const wake = () => { this.controls.staticMoving = false; };
    for (const name of WAKE_EVENTS) canvas.addEventListener(name, wake, { passive: true });
    this.detachDom = () => {
      for (const name of WAKE_EVENTS) canvas.removeEventListener(name, wake);
    };
  }

  /** Per frame, immediately BEFORE `controls.update()`. `update()` rebuilds
   *  `position` from `target + eye` and re-derives the orientation with
   *  `lookAt`; neither round-trip is exact once a focal ride has translated
   *  camera and target together, so the pre-call pose is what `tick()`
   *  compares the result against. */
  capture(camera: THREE.PerspectiveCamera): void {
    this.prePos.copy(camera.position);
    this.preQuat.copy(camera.quaternion);
    this.captured = true;
  }

  /** Per frame, immediately after `controls.update()` — it reads what
   *  that call did. Only valid in the navigate steady state; every other
   *  branch of the animate dispatch leaves `update()` uncalled, so there
   *  is no tail to measure. */
  tick(camera: THREE.PerspectiveCamera, pxPerRad: number, fovYRad: number): void {
    if (this.captured) {
      if (positionHeldStill(this.prePos, camera.position)) camera.position.copy(this.prePos);
      if (orientationHeldStill(this.preQuat, camera.quaternion)) {
        camera.quaternion.copy(this.preQuat);
      }
    }
    this.eye.subVectors(camera.position, this.controls.target);
    if (this.seeded) {
      const px = trackballMotionPx(this.prevEye, this.eye, pxPerRad, fovYRad);
      this.controls.staticMoving = px < TRACKBALL_SETTLE_PX;
    }
    this.prevEye.copy(this.eye);
    this.seeded = true;
  }

  dispose(): void {
    this.detachDom?.();
    this.detachDom = null;
    this.seeded = false;
    this.captured = false;
    this.controls.staticMoving = false;
  }
}

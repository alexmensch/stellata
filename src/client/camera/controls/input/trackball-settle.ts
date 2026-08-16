// Stops TrackballControls' damping tail once its on-screen motion falls
// under a pixel-scale floor. See README.md § Damping settle floor.

import * as THREE from 'three';
import type { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import { TRACKBALL_SETTLE_PX, trackballMotionPx } from './trackball-settle-pure';

const WAKE_EVENTS = ['pointerdown', 'wheel'] as const;

export class TrackballSettle {
  private readonly controls: TrackballControls;
  private readonly prevEye = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
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

  /** Per frame, immediately after `controls.update()` — it reads what
   *  that call did. Only valid in the navigate steady state; every other
   *  branch of the animate dispatch leaves `update()` uncalled, so there
   *  is no tail to measure. */
  tick(camera: THREE.PerspectiveCamera, pxPerRad: number, fovYRad: number): void {
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
    this.controls.staticMoving = false;
  }
}

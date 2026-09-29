// The per-tick camera controller dispatch: one controller moves the camera
// each tick, in a fixed priority order. See README.md.

import type * as THREE from 'three';
import type { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import { TrackballSettle } from '../controls/input/trackball-settle';
import type { AimController } from '../controls/aim-controller';
import type { RollController } from '../controls/input/roll-controller';
import type { FocusController } from '../focus/focus-controller';
import type { ObserveControls } from '../observe/observe-controls';
import type { ObserveLookPin } from '../observe/observe-look-pin';
import type { ObserveTransition } from '../observe/observe-transition';
import type { WarpController } from '../warp/warp-controller';

export interface CameraStepDeps {
  canvas: HTMLElement;
  camera: THREE.PerspectiveCamera;
  controls: TrackballControls;
  observeControls: Pick<ObserveControls, 'update'>;
  observeLookPin: Pick<ObserveLookPin, 'update'>;
  roll: Pick<RollController, 'adoptFromCamera'>;
  warp: Pick<WarpController, 'isActive' | 'tick'>;
  aim: Pick<AimController, 'isActive' | 'tick' | 'isObserveAimActive' | 'tickObserve'>;
  focus: Pick<FocusController, 'getCameraMode' | 'isFocusLerpActive' | 'tick'>;
  observe: Pick<ObserveTransition, 'isAnyActive' | 'tick'>;
  pxPerRadian: () => number;
  fovYRad: () => number;
}

export class CameraStep {
  private readonly settle: TrackballSettle;

  constructor(private readonly deps: CameraStepDeps) {
    this.settle = new TrackballSettle(deps.controls);
    this.settle.attachDom(deps.canvas);
  }

  /** README.md#the-verdict */
  advance(nowMs: number): boolean {
    const d = this.deps;
    // ../controls/input/README.md#roll-authority
    if (d.focus.getCameraMode() === 'observe') d.roll.adoptFromCamera(d.camera);
    const animating = this.dispatch(nowMs);
    // ../controls/input/README.md#the-perpendicular-invariant
    if (animating && d.focus.getCameraMode() === 'navigate') d.roll.adoptFromCamera(d.camera);
    return animating;
  }

  dispose(): void {
    this.settle.dispose();
  }

  private dispatch(nowMs: number): boolean {
    const d = this.deps;
    if (d.warp.isActive()) {
      d.warp.tick(nowMs);
    } else if (d.aim.isActive()) {
      d.aim.tick(nowMs);
    } else if (d.focus.isFocusLerpActive()) {
      d.focus.tick(nowMs);
    } else if (d.aim.isObserveAimActive()) {
      d.aim.tickObserve(nowMs);
      d.observeLookPin.update();
    } else if (d.observe.isAnyActive()) {
      d.observe.tick(nowMs);
    } else if (d.focus.getCameraMode() === 'observe') {
      d.observeControls.update();
      d.observeLookPin.update();
      return false;
    } else {
      this.settle.capture(d.camera);
      d.controls.update();
      this.settle.tick(d.camera, d.pxPerRadian(), d.fovYRad());
      return false;
    }
    return true;
  }
}

// Both focal rides — see README.md.

import * as THREE from 'three';
import type { CadenceReport } from '../../../render-gate/cadence/clock-cadence-pure';
import type { CadenceCtx, SceneLayer } from '../../../scene/scene-layer';
import type { CameraMode } from '../../../stellata';
import type { FocalPerturbationInto } from '../focus-controller';
import { KIND_TRAITS, type FocusableProviders, type Target } from '../focus-target';
import { focalRideStep } from './focal-ride-pure';

type Translatable = { translateFocusFrame(delta: Readonly<THREE.Vector3>): void };

export interface FocalRidesDeps {
  cameraPosition: THREE.Vector3;
  orbitTarget: THREE.Vector3;
  focus: Translatable & {
    getFocusedStar(): number | null;
    getFocusedTarget(): Target | null;
    getCameraMode(): CameraMode;
  };
  observe: Translatable;
  focusables: FocusableProviders;
  starLocalPositionInto: (idx: number, out: THREE.Vector3) => THREE.Vector3;
  warpActive: () => boolean;
  rebasePose: (delta: Readonly<THREE.Vector3>) => void;
  noteRideStep: (delta: Readonly<THREE.Vector3>) => void;
  planetRate: (cc: CadenceCtx) => CadenceReport;
  onFocus: (handler: () => void) => () => void;
}

export class FocalRides {
  readonly movingEntry: SceneLayer;

  private readonly focalPert = new THREE.Vector3();
  private readonly lastAppliedPert = new THREE.Vector3();
  private readonly rideDelta = new THREE.Vector3();
  private readonly rideLive = new THREE.Vector3();
  private rideFocalIdx: number | null = null;

  private readonly movingLast = new THREE.Vector3();
  private readonly movingLive = new THREE.Vector3();
  private readonly movingDelta = new THREE.Vector3();
  private movingIdx: number | null = null;

  private readonly offFocus: () => void;

  constructor(private readonly deps: FocalRidesDeps) {
    this.movingEntry = {
      timeBehaviour: { kind: 'clock', rate: deps.planetRate },
      contribution: { kind: 'always' },
      update: () => this.rideMovingFocal(),
      dispose: () => {},
    };
    this.offFocus = deps.onFocus(() => this.reseedMoving());
  }

  rideBinaryFocal(perturbation: FocalPerturbationInto): void {
    const d = this.deps;
    const focal = d.focus.getFocusedStar();
    const hasPert = focal !== null && perturbation(focal, this.focalPert);
    if (!hasPert) this.focalPert.set(0, 0, 0);

    const live = focal !== null
      ? d.starLocalPositionInto(focal, this.rideLive)
      : this.rideLive.set(0, 0, 0);
    const step = focalRideStep({
      focal,
      rideFocalIdx: this.rideFocalIdx,
      warpActive: d.warpActive(),
      focalPert: this.focalPert,
      lastAppliedPert: this.lastAppliedPert,
      liveLocal: live,
      target: d.orbitTarget,
      cameraPosition: d.cameraPosition,
      observeMode: d.focus.getCameraMode() === 'observe',
    });
    this.rideFocalIdx = step.rideFocalIdx;
    this.lastAppliedPert.set(step.px, step.py, step.pz);
    this.rideDelta.set(step.dx, step.dy, step.dz);
    this.applyRideDelta(this.rideDelta);
  }

  /** Owed after a policy recentre only — README.md#files. */
  reseedMoving(): void {
    this.movingIdx = null;
  }

  dispose(): void {
    this.offFocus();
    this.focalPert.set(0, 0, 0);
    this.lastAppliedPert.set(0, 0, 0);
    this.rideFocalIdx = null;
    this.movingLast.set(0, 0, 0);
    this.movingIdx = null;
  }

  private rideMovingFocal(): void {
    const d = this.deps;
    const focused = d.focus.getFocusedTarget();
    if (focused === null || !KIND_TRAITS[focused.kind].moving) {
      this.movingIdx = null;
      return;
    }
    const idx = focused.idx;
    const live = this.movingLive;
    if (!d.focusables[focused.kind].localPositionInto(idx, live)) {
      this.movingIdx = null;
      return;
    }
    const step = focalRideStep({
      focal: idx,
      rideFocalIdx: this.movingIdx,
      warpActive: d.warpActive(),
      focalPert: live,
      lastAppliedPert: this.movingLast,
      liveLocal: live,
      target: d.orbitTarget,
      cameraPosition: d.cameraPosition,
      observeMode: d.focus.getCameraMode() === 'observe',
    });
    this.movingIdx = step.rideFocalIdx;
    this.movingLast.set(step.px, step.py, step.pz);
    this.movingDelta.set(step.dx, step.dy, step.dz);
    this.applyRideDelta(this.movingDelta);
  }

  /** A ride runs below the render gate, so a delta that reaches the camera
   *  without reaching `rebasePose` reads as a fresh camera move on the next
   *  tick and pins the gate open (../../../render-gate/README.md#the-focal-ride). */
  private applyRideDelta(delta: THREE.Vector3): void {
    if (delta.lengthSq() === 0) return;
    const d = this.deps;
    d.cameraPosition.add(delta);
    d.orbitTarget.add(delta);
    d.focus.translateFocusFrame(delta);
    d.observe.translateFocusFrame(delta);
    d.rebasePose(delta);
    d.noteRideStep(delta);
  }
}

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { CameraMode } from '../focus-controller';
import type { FrameCtx } from '../../../scene/scene-layer';
import type { FocusableProviders, Target } from '../focus-target';
import { FocalRides } from './focal-rides';

interface Rig {
  rides: FocalRides;
  camera: THREE.Vector3;
  target: THREE.Vector3;
  focusShift: THREE.Vector3;
  observeShift: THREE.Vector3;
  rebased: THREE.Vector3;
  noted: THREE.Vector3;
  rebasePose: ReturnType<typeof vi.fn>;
  noteRideStep: ReturnType<typeof vi.fn>;
  emitFocus: () => void;
  offFocus: ReturnType<typeof vi.fn>;
  state: {
    star: number | null;
    focused: Target | null;
    mode: CameraMode;
    warp: boolean;
    starLive: THREE.Vector3;
    bodyLive: THREE.Vector3 | null;
  };
}

const planetRate = () => ({ screenPxPerSimS: 0, fluxFracPerSimS: 0, observedPx: 0, observedFluxFrac: 0 });

function rig(): Rig {
  const camera = new THREE.Vector3(0, 0, 10);
  const target = new THREE.Vector3();
  const focusShift = new THREE.Vector3();
  const observeShift = new THREE.Vector3();
  const rebased = new THREE.Vector3();
  const noted = new THREE.Vector3();
  const state: Rig['state'] = {
    star: null, focused: null, mode: 'navigate', warp: false,
    starLive: new THREE.Vector3(), bodyLive: null,
  };
  const bodyLeg = (_idx: number, out: THREE.Vector3) => {
    if (state.bodyLive === null) return false;
    out.copy(state.bodyLive);
    return true;
  };
  const focusables = {
    planet: { localPositionInto: bodyLeg },
    probe: { localPositionInto: bodyLeg },
    star: { localPositionInto: bodyLeg },
  } as unknown as FocusableProviders;
  let focusHandler: () => void = () => {};
  const offFocus = vi.fn();
  const rebasePose = vi.fn((d: THREE.Vector3) => { rebased.add(d); });
  const noteRideStep = vi.fn((d: THREE.Vector3) => { noted.add(d); });
  const rides = new FocalRides({
    cameraPosition: camera,
    orbitTarget: target,
    focus: {
      getFocusedStar: () => state.star,
      getFocusedTarget: () => state.focused,
      getCameraMode: () => state.mode,
      translateFocusFrame: (d) => { focusShift.add(d); },
    },
    observe: { translateFocusFrame: (d) => { observeShift.add(d); } },
    focusables,
    starLocalPositionInto: (_idx, out) => out.copy(state.starLive),
    warpActive: () => state.warp,
    rebasePose,
    noteRideStep,
    planetRate,
    onFocus: (handler) => { focusHandler = handler; return offFocus; },
  });
  return {
    rides, camera, target, focusShift, observeShift, rebased, noted,
    rebasePose, noteRideStep, emitFocus: () => focusHandler(), offFocus, state,
  };
}

const pertOf = (p: THREE.Vector3 | null) => (_idx: number, out: THREE.Vector3) => {
  if (p === null) return false;
  out.copy(p);
  return true;
};

const frame = {} as FrameCtx;
const xyz = (v: THREE.Vector3) => [v.x, v.y, v.z];

describe('FocalRides — binary focal ride', () => {
  it('seed frame snaps the orbit target onto the live slot, moving the camera with it', () => {
    const r = rig();
    r.state.star = 7;
    r.state.starLive.set(1, 2, 3);
    r.rides.rideBinaryFocal(pertOf(new THREE.Vector3(1, 2, 3)));
    expect(xyz(r.target)).toEqual([1, 2, 3]);
    expect(xyz(r.camera)).toEqual([1, 2, 13]);
    expect(xyz(r.focusShift)).toEqual([1, 2, 3]);
    expect(xyz(r.observeShift)).toEqual([1, 2, 3]);
  });

  it('a seed snap rebases the gate but is no camera velocity', () => {
    const r = rig();
    r.state.star = 7;
    r.state.starLive.set(1, 2, 3);
    r.rides.rideBinaryFocal(pertOf(new THREE.Vector3(1, 2, 3)));
    expect(xyz(r.rebased)).toEqual([1, 2, 3]);
    expect(r.noteRideStep).not.toHaveBeenCalled();
  });

  it('seed frame measures from the camera in observe', () => {
    const r = rig();
    r.state.star = 7;
    r.state.mode = 'observe';
    r.state.starLive.set(0, 0, 4);
    r.rides.rideBinaryFocal(pertOf(new THREE.Vector3()));
    expect(xyz(r.camera)).toEqual([0, 0, 4]);
    expect(xyz(r.target)).toEqual([0, 0, -6]);
  });

  it('steady frames translate by the perturbation change and report it to gate and cadence', () => {
    const r = rig();
    r.state.star = 7;
    r.rides.rideBinaryFocal(pertOf(new THREE.Vector3(1, 0, 0)));
    r.rebasePose.mockClear();
    r.noteRideStep.mockClear();
    r.rebased.set(0, 0, 0);
    r.noted.set(0, 0, 0);
    const cam0 = r.camera.clone();
    r.rides.rideBinaryFocal(pertOf(new THREE.Vector3(1.5, 0, -2)));
    expect(xyz(r.camera.clone().sub(cam0))).toEqual([0.5, 0, -2]);
    expect(xyz(r.rebased)).toEqual([0.5, 0, -2]);
    expect(xyz(r.noted)).toEqual([0.5, 0, -2]);
  });

  it('a frame with no drift reaches neither the camera nor the gate', () => {
    const r = rig();
    r.state.star = 7;
    const p = pertOf(new THREE.Vector3(1, 0, 0));
    r.rides.rideBinaryFocal(p);
    r.rebasePose.mockClear();
    r.noted.set(0, 0, 0);
    const cam0 = r.camera.clone();
    r.rides.rideBinaryFocal(p);
    expect(r.rebasePose).not.toHaveBeenCalled();
    expect(xyz(r.camera)).toEqual(xyz(cam0));
    expect(xyz(r.noted)).toEqual([0, 0, 0]);
  });

  it('a warp moves nothing and resyncs the baseline, so no jump accrues when it ends', () => {
    const r = rig();
    r.state.star = 7;
    r.rides.rideBinaryFocal(pertOf(new THREE.Vector3()));
    r.state.warp = true;
    const cam0 = r.camera.clone();
    r.rides.rideBinaryFocal(pertOf(new THREE.Vector3(9, 9, 9)));
    expect(xyz(r.camera)).toEqual(xyz(cam0));
    r.state.warp = false;
    r.rides.rideBinaryFocal(pertOf(new THREE.Vector3(9, 9, 10)));
    expect(xyz(r.camera.clone().sub(cam0))).toEqual([0, 0, 1]);
  });

  it('an absent perturbation reads as zero drift', () => {
    const r = rig();
    r.state.star = 7;
    r.rides.rideBinaryFocal(pertOf(new THREE.Vector3(2, 0, 0)));
    const cam0 = r.camera.clone();
    r.rides.rideBinaryFocal(pertOf(null));
    expect(xyz(r.camera.clone().sub(cam0))).toEqual([-2, 0, 0]);
  });
});

describe('FocalRides — moving-focal ride', () => {
  const planet: Target = { kind: 'planet', idx: 3 };

  it('rides the body\'s frame-to-frame delta after the seed frame', () => {
    const r = rig();
    r.state.focused = planet;
    r.state.bodyLive = new THREE.Vector3(5, 0, 0);
    r.rides.movingEntry.update!(frame);
    expect(xyz(r.target)).toEqual([5, 0, 0]);
    r.state.bodyLive.set(5, 1, 0);
    r.rides.movingEntry.update!(frame);
    expect(xyz(r.target)).toEqual([5, 1, 0]);
    expect(xyz(r.camera)).toEqual([5, 1, 10]);
    expect(xyz(r.noted)).toEqual([0, 1, 0]);
  });

  it('ignores a kind that does not move', () => {
    const r = rig();
    r.state.focused = { kind: 'star', idx: 3 };
    r.state.bodyLive = new THREE.Vector3(5, 0, 0);
    r.rides.movingEntry.update!(frame);
    expect(xyz(r.target)).toEqual([0, 0, 0]);
  });

  it('a focus event reseeds: the next frame re-snaps rather than adding the jump', () => {
    const r = rig();
    r.state.focused = planet;
    r.state.bodyLive = new THREE.Vector3(5, 0, 0);
    r.rides.movingEntry.update!(frame);
    r.target.set(0, 0, 0);
    r.state.bodyLive.set(1, 0, 0);
    r.emitFocus();
    r.rides.movingEntry.update!(frame);
    expect(xyz(r.target)).toEqual([1, 0, 0]);
  });

  it('reseedMoving has the same effect as a focus event', () => {
    const r = rig();
    r.state.focused = planet;
    r.state.bodyLive = new THREE.Vector3(5, 0, 0);
    r.rides.movingEntry.update!(frame);
    r.target.set(0, 0, 0);
    r.state.bodyLive.set(1, 0, 0);
    r.rides.reseedMoving();
    r.rides.movingEntry.update!(frame);
    expect(xyz(r.target)).toEqual([1, 0, 0]);
  });

  it('schedules on the planet rate', () => {
    expect(rig().rides.movingEntry.timeBehaviour).toEqual({ kind: 'clock', rate: planetRate });
  });
});

describe('FocalRides — epoch follow', () => {
  it('translates camera, target and both transition caches by the step', () => {
    const r = rig();
    r.rides.followEpochStep(new THREE.Vector3(0.25, -1, 2));
    expect(xyz(r.camera)).toEqual([0.25, -1, 12]);
    expect(xyz(r.target)).toEqual([0.25, -1, 2]);
    expect(xyz(r.focusShift)).toEqual([0.25, -1, 2]);
    expect(xyz(r.observeShift)).toEqual([0.25, -1, 2]);
  });

  it('rebases the gate snapshot but stays out of the cadence camera velocity', () => {
    const r = rig();
    r.rides.followEpochStep(new THREE.Vector3(1, 0, 0));
    expect(xyz(r.rebased)).toEqual([1, 0, 0]);
    expect(r.noteRideStep).not.toHaveBeenCalled();
  });

  it('moves nothing during a warp', () => {
    const r = rig();
    r.state.warp = true;
    r.rides.followEpochStep(new THREE.Vector3(1, 0, 0));
    expect(xyz(r.camera)).toEqual([0, 0, 10]);
    expect(xyz(r.focusShift)).toEqual([0, 0, 0]);
  });

  it('leaves the binary ride steady: the next frame adds only the orbital drift', () => {
    const r = rig();
    r.state.star = 7;
    r.rides.rideBinaryFocal(pertOf(new THREE.Vector3(1, 0, 0)));
    r.rides.followEpochStep(new THREE.Vector3(0, 3, 0));
    const cam0 = r.camera.clone();
    r.rides.rideBinaryFocal(pertOf(new THREE.Vector3(1, 0, 0.5)));
    expect(xyz(r.camera.clone().sub(cam0))).toEqual([0, 0, 0.5]);
  });
});

describe('FocalRides — dispose', () => {
  it('the registry disposing the moving entry disposes the rides: focus unsubscribes', () => {
    const r = rig();
    r.rides.movingEntry.dispose();
    expect(r.offFocus).toHaveBeenCalledTimes(1);
  });
});

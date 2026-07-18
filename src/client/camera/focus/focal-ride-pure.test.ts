import { describe, it, expect } from 'vitest';
import {
  FOCAL_ORIGIN_DRIFT_RATIO,
  focalRideStep,
  shouldRecenterFocalOrigin,
  type FocalRideInputs,
} from './focal-ride-pure';

const V = (x: number, y: number, z: number) => ({ x, y, z });

function base(over: Partial<FocalRideInputs> = {}): FocalRideInputs {
  return {
    focal: 1,
    rideFocalIdx: 1,
    warpActive: false,
    focalPert: V(0, 0, 0),
    lastAppliedPert: V(0, 0, 0),
    liveLocal: V(0, 0, 0),
    target: V(0, 0, 0),
    observeMode: false,
    ...over,
  };
}

describe('focalRideStep', () => {
  it('steady focal: translates by the per-frame perturbation change', () => {
    const s = focalRideStep(base({
      focalPert: V(5, 7, -3),
      lastAppliedPert: V(4, 7, -1),
    }));
    expect([s.dx, s.dy, s.dz]).toEqual([1, 0, -2]);
    expect([s.px, s.py, s.pz]).toEqual([5, 7, -3]);
    expect(s.rideFocalIdx).toBe(1);
  });

  it('steady focal preserves a user pan offset (does not re-snap to live)', () => {
    // target sits away from liveLocal (user panned); steady frame must not
    // yank it back — it only adds the orbital drift.
    const s = focalRideStep(base({
      focalPert: V(2, 0, 0),
      lastAppliedPert: V(2, 0, 0),
      liveLocal: V(0, 0, 0),
      target: V(9, 9, 9),
    }));
    expect([s.dx, s.dy, s.dz]).toEqual([0, 0, 0]);
  });

  it('seed frame re-snaps target onto the live buffer position', () => {
    // The regression: setFocus placed target at a stale event-time sample;
    // by this frame the star's live position has moved. The seed re-snap
    // translates by (live − target) so the star lands centred.
    const s = focalRideStep(base({
      focal: 1,
      rideFocalIdx: null,
      focalPert: V(3, -1, 4),
      liveLocal: V(3, -1, 4),
      target: V(0.5, 0, 0.5), // stale event-time snap
    }));
    expect([s.dx, s.dy, s.dz]).toEqual([2.5, -1, 3.5]);
    // Baseline resyncs to this frame's perturbation.
    expect([s.px, s.py, s.pz]).toEqual([3, -1, 4]);
    expect(s.rideFocalIdx).toBe(1);
  });

  it('seed frame is a no-op translate when target already matches live', () => {
    const s = focalRideStep(base({
      rideFocalIdx: null,
      focalPert: V(3, -1, 4),
      liveLocal: V(3, -1, 4),
      target: V(3, -1, 4),
    }));
    expect([s.dx, s.dy, s.dz]).toEqual([0, 0, 0]);
  });

  it('seed frame in observe mode: no re-snap — target is the look pin, not the star', () => {
    // Cold-load observe URL restore: the first-ever ride frame runs with
    // mode already observe, where observeUpdateTarget parks target one
    // parsec ahead of the camera. Re-snapping against that target would
    // translate the star-parked camera a full parsec off the focal star.
    const s = focalRideStep(base({
      rideFocalIdx: null,
      focalPert: V(3, -1, 4),
      liveLocal: V(3, -1, 4),
      target: V(4, -1, 4), // camera + 1 pc forward
      observeMode: true,
    }));
    expect([s.dx, s.dy, s.dz]).toEqual([0, 0, 0]);
    // Baseline still resyncs so the steady-state ride takes over cleanly.
    expect([s.px, s.py, s.pz]).toEqual([3, -1, 4]);
    expect(s.rideFocalIdx).toBe(1);
  });

  it('warp active: never translates, only resyncs the baseline', () => {
    const s = focalRideStep(base({
      warpActive: true,
      focal: 2,
      rideFocalIdx: 1, // focal also changed, but warp wins
      focalPert: V(5, 5, 5),
      liveLocal: V(9, 9, 9),
      target: V(0, 0, 0),
    }));
    expect([s.dx, s.dy, s.dz]).toEqual([0, 0, 0]);
    expect([s.px, s.py, s.pz]).toEqual([5, 5, 5]);
    expect(s.rideFocalIdx).toBe(2);
  });

  it('unfocus (focal null): no translate, baseline cleared to zero pert', () => {
    const s = focalRideStep(base({
      focal: null,
      rideFocalIdx: 1,
      focalPert: V(0, 0, 0),
      liveLocal: V(0, 0, 0),
      target: V(4, 4, 4),
    }));
    expect([s.dx, s.dy, s.dz]).toEqual([0, 0, 0]);
    expect(s.rideFocalIdx).toBeNull();
  });
});

describe('shouldRecenterFocalOrigin', () => {
  it('holds until the camera drifts past the ratio, then triggers', () => {
    const eye = 1e-4; // ride-along eye distance, pc
    expect(shouldRecenterFocalOrigin(eye, eye)).toBe(false);
    expect(shouldRecenterFocalOrigin(eye * FOCAL_ORIGIN_DRIFT_RATIO, eye)).toBe(false);
    expect(shouldRecenterFocalOrigin(eye * FOCAL_ORIGIN_DRIFT_RATIO * 1.001, eye)).toBe(true);
  });

  it('scales with the eye distance — same trigger geometry at any zoom/object', () => {
    for (const eye of [1e-9, 1e-4, 1, 100]) {
      expect(shouldRecenterFocalOrigin(eye * (FOCAL_ORIGIN_DRIFT_RATIO + 1), eye)).toBe(true);
      expect(shouldRecenterFocalOrigin(eye * (FOCAL_ORIGIN_DRIFT_RATIO - 1), eye)).toBe(false);
    }
  });

  it('never triggers on a degenerate (zero) eye distance', () => {
    expect(shouldRecenterFocalOrigin(1, 0)).toBe(false);
  });
});

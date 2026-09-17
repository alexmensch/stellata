import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  type CapturePose,
  capturePose,
  easeAt,
  frameMismatch,
  lerpPose,
  planClock,
  slerpUnit,
  takeFrameAt,
} from './capture-pure';
import type { DecodedView } from '../../util/url-state';

const pose = (
  cam: [number, number, number],
  tgt: [number, number, number] = [0, 0, 0],
  up: [number, number, number] = [0, 1, 0],
  fov = 60,
): CapturePose => capturePose({ cam, tgt, up, fov });

const out = (): CapturePose => pose([0, 0, 0]);

describe('easeAt', () => {
  it('pins both endpoints and the midpoint', () => {
    expect(easeAt('smooth', 0)).toBe(0);
    expect(easeAt('smooth', 0.5)).toBe(0.5);
    expect(easeAt('smooth', 1)).toBe(1);
  });

  it('clamps outside [0,1] so a late frame cannot overshoot the end pose', () => {
    expect(easeAt('smooth', 1.4)).toBe(1);
    expect(easeAt('linear', -0.2)).toBe(0);
  });

  it('starts and ends still — the quintic derivative vanishes at both ends', () => {
    const d = 1e-4;
    expect(easeAt('smooth', d)).toBeLessThan(d / 1000);
    expect(1 - easeAt('smooth', 1 - d)).toBeLessThan(d / 1000);
  });

  it('linear is the identity', () => {
    expect(easeAt('linear', 0.25)).toBe(0.25);
  });
});

describe('slerpUnit', () => {
  it('lands halfway along the great circle, not on the chord', () => {
    const got = slerpUnit(
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), 0.5, new THREE.Vector3(),
    );
    expect(got.length()).toBeCloseTo(1, 12);
    expect(got.x).toBeCloseTo(Math.SQRT1_2, 12);
    expect(got.y).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('holds an antipodal pair on the unit sphere', () => {
    const got = slerpUnit(
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), 0.5, new THREE.Vector3(),
    );
    expect(got.length()).toBeCloseTo(1, 12);
  });
});

describe('lerpPose', () => {
  it('reproduces each endpoint exactly', () => {
    const a = pose([0, 0, 30], [0, 0, 0], [0, 1, 0], 60);
    const b = pose([0.7, 0, 0.6], [1, 0, 0], [0, 0, 1], 35);
    const at0 = lerpPose(a, b, 0, out());
    expect(at0.cam.distanceTo(a.cam)).toBeCloseTo(0, 10);
    expect(at0.fov).toBe(60);
    const at1 = lerpPose(a, b, 1, out());
    expect(at1.cam.distanceTo(b.cam)).toBeCloseTo(0, 10);
    expect(at1.tgt.distanceTo(b.tgt)).toBeCloseTo(0, 10);
    expect(at1.fov).toBeCloseTo(35, 10);
  });

  it('halves the radius geometrically, not linearly', () => {
    // 100 → 1 over the move: the geometric midpoint is 10, the arithmetic
    // one 50.5. Equal time per decade is what keeps a dolly readable.
    const a = pose([100, 0, 0]);
    const b = pose([1, 0, 0]);
    expect(lerpPose(a, b, 0.5, out()).cam.length()).toBeCloseTo(10, 9);
  });

  it('measures the radius from the target, not the origin', () => {
    const a = pose([12, 0, 0], [10, 0, 0]);
    const b = pose([10, 0, 0.5], [10, 0, 0]);
    const mid = lerpPose(a, b, 0.5, out());
    expect(mid.cam.distanceTo(new THREE.Vector3(10, 0, 0))).toBeCloseTo(1, 9);
  });

  it('interpolates fov geometrically too', () => {
    const a = pose([0, 0, 30], [0, 0, 0], [0, 1, 0], 90);
    const b = pose([0, 0, 30], [0, 0, 0], [0, 1, 0], 10);
    expect(lerpPose(a, b, 0.5, out()).fov).toBeCloseTo(30, 9);
  });

  it('falls back to a chord when a pose sits on its own target', () => {
    const a = pose([0, 0, 0]);
    const b = pose([0, 0, 10]);
    expect(lerpPose(a, b, 0.5, out()).cam.z).toBeCloseTo(5, 9);
  });

  it('keeps up a unit vector through the arc', () => {
    const a = pose([0, 0, 30], [0, 0, 0], [0, 1, 0]);
    const b = pose([0, 0, 30], [0, 0, 0], [1, 0, 0]);
    expect(lerpPose(a, b, 0.3, out()).up.length()).toBeCloseTo(1, 12);
  });
});

describe('frameMismatch', () => {
  const sid = (id: number): DecodedView => ({ focus: { kind: 'sid', id } });

  it('passes two views on one focus', () => {
    expect(frameMismatch(sid(9031), sid(9031))).toBeNull();
  });

  it('refuses two different focuses — the poses are in different frames', () => {
    expect(frameMismatch(sid(9031), sid(42))).toMatch(/focus differs/);
  });

  it('refuses an observe-mode blob', () => {
    expect(frameMismatch({ mode: 'observe' }, {})).toMatch(/OBSERVE/);
  });

  it('refuses a worldOffset the other view does not carry', () => {
    expect(frameMismatch({ worldOffset: [1, 2, 3] }, {})).toMatch(/worldOffset differs/);
  });

  it('reads an absent focus as the default rather than as unfocused', () => {
    expect(frameMismatch({}, { focus: 'cleared' })).toMatch(/focus differs/);
  });
});

describe('takeFrameAt', () => {
  const shape = { delayMs: 1000, moveMs: 4000, holdMs: 500 };

  it('holds the start pose through the delay', () => {
    expect(takeFrameAt(shape, 0, 'smooth')).toEqual({ phase: 'delay', s: 0 });
    expect(takeFrameAt(shape, 999, 'smooth')).toEqual({ phase: 'delay', s: 0 });
  });

  it('starts moving the instant the delay is up', () => {
    expect(takeFrameAt(shape, 1000, 'smooth')).toEqual({ phase: 'move', s: 0 });
  });

  it('eases the middle of the move', () => {
    expect(takeFrameAt(shape, 3000, 'smooth').s).toBe(0.5);
    expect(takeFrameAt(shape, 2000, 'linear').s).toBe(0.25);
  });

  it('writes the end pose exactly from the moment it lands', () => {
    expect(takeFrameAt(shape, 5000, 'smooth')).toEqual({ phase: 'hold', s: 1 });
    expect(takeFrameAt(shape, 5400, 'smooth')).toEqual({ phase: 'hold', s: 1 });
  });

  it('is done once the hold is spent', () => {
    expect(takeFrameAt(shape, 5500, 'smooth').phase).toBe('done');
  });

  it('is done at the landing when nothing is held', () => {
    expect(takeFrameAt({ ...shape, holdMs: 0 }, 5000, 'smooth').phase).toBe('done');
  });

  it('lands where the wall clock says after a stall, not one frame on', () => {
    // A frame dropped at 2 s and delivered at 4.5 s reads 0.875 through the
    // move, not the next step from 0.25 — the take ends on time either way.
    expect(takeFrameAt(shape, 4500, 'linear').s).toBe(0.875);
  });

  it('opens on the move when no delay is asked for', () => {
    expect(takeFrameAt({ ...shape, delayMs: 0 }, 0, 'smooth').phase).toBe('move');
  });
});

describe('planClock', () => {
  const base = { startT: null, endT: null, rate: 1, seconds: 5, currentT: 1000 };

  it('runs the requested rate throughout when no end time is given', () => {
    expect(planClock({ ...base, rate: 120 })).toEqual({
      startT: null, moveRate: 120, idleRate: 120, endT: null,
    });
  });

  it('freezes the sky at rate 0', () => {
    expect(planClock({ ...base, rate: 0 }).moveRate).toBe(0);
  });

  it('solves the rate that lands on the end time as the move ends', () => {
    const plan = planClock({ ...base, startT: 0, endT: 86400, seconds: 10 });
    expect(plan.moveRate).toBe(8640);
    expect(plan.endT).toBe(86400);
  });

  it('pins the clock either side of the move when an end time solves it', () => {
    expect(planClock({ ...base, startT: 0, endT: 100 }).idleRate).toBe(0);
  });

  it('solves backwards for an end time before the start', () => {
    expect(planClock({ ...base, startT: 100, endT: 50, seconds: 5 }).moveRate).toBe(-10);
  });

  it('solves from the live clock when only an end time is given', () => {
    expect(planClock({ ...base, endT: 1500, seconds: 5 }).moveRate).toBe(100);
  });
});

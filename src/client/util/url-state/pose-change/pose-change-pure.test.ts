import { describe, expect, it } from 'vitest';
import {
  POSE_CHANGE_EPS,
  divergesFromDefault,
  orbitRadius,
  poseChanged,
} from './pose-change-pure';
import { AU_PC, KM_PC } from '../../astronomy-constants';

const v = (x: number, y: number, z: number) => ({ x, y, z });

/** A cam / tgt / up snapshot in `startUrlSync`'s 9-slot layout. */
function snapshot(cam: number[], tgt: number[], up: number[]): Float64Array {
  return Float64Array.from([...cam, ...tgt, ...up]);
}

const POLE = [0, 1, 0];

/** Camera at `r` along +z from the origin, looking at it. */
function parked(r: number): Float64Array {
  return snapshot([0, 0, r], [0, 0, 0], POLE);
}

/** The same pose rotated `angleRad` about the target, in the x–z plane. */
function orbited(r: number, angleRad: number) {
  return v(r * Math.sin(angleRad), 0, r * Math.cos(angleRad));
}

// The camera reaches every one of these in a session, and the threshold has to
// behave identically at all of them — that is the whole claim. Ten orders of
// magnitude, closest first.
const VANTAGES: Array<[string, number]> = [
  ['4,322 km off the Moon', 4322 * KM_PC],
  ['the first-load 5 AU park', 5 * AU_PC],
  ['a 30 pc navigate default', 30],
  ['Sol to the galactic centre', 8500],
  ['out at Andromeda', 1e6],
];

describe('poseChanged — one rule at every vantage', () => {
  it.each(VANTAGES)('ignores a sub-threshold orbit %s', (_name, r) => {
    const prev = parked(r);
    const moved = orbited(r, POSE_CHANGE_EPS * 0.5);
    expect(poseChanged(prev, moved, v(0, 0, 0), v(...(POLE as [number, number, number]))))
      .toBe(false);
  });

  it.each(VANTAGES)('catches a supra-threshold orbit %s', (_name, r) => {
    const prev = parked(r);
    const moved = orbited(r, POSE_CHANGE_EPS * 2);
    expect(poseChanged(prev, moved, v(0, 0, 0), v(...(POLE as [number, number, number]))))
      .toBe(true);
  });

  it.each(VANTAGES)('catches a dolly of one part in 10^3 %s', (_name, r) => {
    const prev = parked(r);
    expect(poseChanged(prev, v(0, 0, r * 1.001), v(0, 0, 0), v(0, 1, 0))).toBe(true);
  });

  it('records a full circuit of the Moon, which an absolute floor would swallow', () => {
    const r = 4322 * KM_PC;
    const prev = parked(r);
    const quarterTurn = orbited(r, Math.PI / 2);
    expect(orbitRadius(quarterTurn, v(0, 0, 0))).toBeCloseTo(r, 20);
    expect(poseChanged(prev, quarterTurn, v(0, 0, 0), v(0, 1, 0))).toBe(true);
    expect(poseChanged(prev, orbited(r, (38 * Math.PI) / 180), v(0, 0, 0), v(0, 1, 0)))
      .toBe(true);
  });

  it('reads a stationary pose as unchanged', () => {
    const r = 30;
    expect(poseChanged(parked(r), v(0, 0, r), v(0, 0, 0), v(0, 1, 0))).toBe(false);
  });

  // A translation of the whole pose IS a change here — the caller is what
  // makes a focal ride invisible, by handing in pose vectors already measured
  // from the focal object (`../anchored-pose.ts`). Left to this module
  // it would read as motion, which is right for free flight and would be
  // per-frame URL churn for a ride.
  it('reads a translation of the whole pose as a change', () => {
    const r = 4322 * KM_PC;
    const d = 1e3 * KM_PC;
    const prev = parked(r);
    expect(poseChanged(prev, v(d, 0, r + d), v(d, 0, d), v(0, 1, 0))).toBe(true);
  });

  it('catches a roll, which moves neither point', () => {
    const r = 30;
    const prev = parked(r);
    const rolled = POSE_CHANGE_EPS * 2;
    expect(poseChanged(prev, v(0, 0, r), v(0, 0, 0),
      v(Math.sin(rolled), Math.cos(rolled), 0))).toBe(true);
    const still = POSE_CHANGE_EPS * 0.5;
    expect(poseChanged(prev, v(0, 0, r), v(0, 0, 0),
      v(Math.sin(still), Math.cos(still), 0))).toBe(false);
  });

  // With cam ON the target there is no radius, so the move is its own scale
  // and any motion counts — while stillness reads as unchanged rather than
  // as a divide by zero.
  it('answers a degenerate radius without a floor', () => {
    const zero = snapshot([0, 0, 0], [0, 0, 0], POLE);
    expect(poseChanged(zero, v(0, 0, 0), v(0, 0, 0), v(0, 1, 0))).toBe(false);
    expect(poseChanged(zero, v(1e-30, 0, 0), v(0, 0, 0), v(0, 1, 0))).toBe(true);
  });
});

describe('divergesFromDefault — the encoder gate on the same scale', () => {
  const DEFAULT_TGT: [number, number, number] = [0, 0, 0];

  it.each(VANTAGES)('elides a target sitting on the focus %s', (_name, r) => {
    expect(divergesFromDefault(v(0, 0, 0), DEFAULT_TGT, r)).toBe(false);
  });

  it('encodes a 500 km pan at the Moon, which an absolute band would elide', () => {
    const r = 4322 * KM_PC;
    const pan = v(500 * KM_PC, 0, 0);
    expect(divergesFromDefault(pan, DEFAULT_TGT, r)).toBe(true);
    expect(Math.abs(pan.x)).toBeLessThan(1e-3);
  });

  it('encodes an Earth-distance anchor, which an absolute band would read as Sol', () => {
    const r = 4322 * KM_PC;
    const anchor = v(AU_PC, 0, 0);
    expect(divergesFromDefault(anchor, [0, 0, 0], r)).toBe(true);
    expect(anchor.x).toBeLessThan(1e-3);
  });

  it('elides an anchor at Sol itself', () => {
    expect(divergesFromDefault(v(0, 0, 0), [0, 0, 0], 30)).toBe(false);
  });
});

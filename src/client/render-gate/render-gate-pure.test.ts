import { describe, expect, it } from 'vitest';
import {
  POSE_SLOTS,
  SETTLE_MS,
  decideRender,
  posesDiffer,
  writePose,
} from './render-gate-pure';

const pose = (fov = 50) => {
  const out = new Float64Array(POSE_SLOTS);
  writePose(
    out,
    { x: 1, y: 2, z: 3 },
    { x: 0, y: 0, z: 0, w: 1 },
    fov,
    { x: 4, y: 5, z: 6 },
    { x: 7, y: 8, z: 9 },
  );
  return out;
};

describe('writePose / posesDiffer', () => {
  it('fills every slot', () => {
    expect(POSE_SLOTS).toBe(14);
    expect(Array.from(pose())).toEqual([1, 2, 3, 0, 0, 0, 1, 50, 4, 5, 6, 7, 8, 9]);
  });

  it('identical poses do not differ', () => {
    expect(posesDiffer(pose(), pose())).toBe(false);
  });

  it('any single slot change is detected', () => {
    for (let i = 0; i < POSE_SLOTS; i++) {
      const b = pose();
      b[i] += 1e-9;
      expect(posesDiffer(pose(), b)).toBe(true);
    }
  });

  it('a NaN-seeded snapshot differs from any real pose', () => {
    const seed = new Float64Array(POSE_SLOTS).fill(Number.NaN);
    expect(posesDiffer(seed, pose())).toBe(true);
  });
});

describe('decideRender', () => {
  const idle = { holds: 0, lastActiveMs: Number.NEGATIVE_INFINITY };
  const quiet = { continuous: false, poseChanged: false, nowMs: 10_000 };

  it('settle tail is pinned', () => {
    expect(SETTLE_MS).toBe(1500);
  });

  it('idle with no activity skips', () => {
    expect(decideRender(idle, quiet).render).toBe(false);
  });

  it('a hold renders without refreshing the activity stamp', () => {
    const d = decideRender({ ...idle, holds: 1 }, quiet);
    expect(d.render).toBe(true);
    expect(d.lastActiveMs).toBe(Number.NEGATIVE_INFINITY);
  });

  it('continuous and poseChanged render and stamp activity', () => {
    for (const inputs of [
      { ...quiet, continuous: true },
      { ...quiet, poseChanged: true },
    ]) {
      const d = decideRender(idle, inputs);
      expect(d.render).toBe(true);
      expect(d.lastActiveMs).toBe(inputs.nowMs);
    }
  });

  it('renders through the settle tail, then stops', () => {
    const state = { holds: 0, lastActiveMs: 10_000 };
    expect(decideRender(state, { ...quiet, nowMs: 10_000 + SETTLE_MS - 1 }).render).toBe(true);
    expect(decideRender(state, { ...quiet, nowMs: 10_000 + SETTLE_MS }).render).toBe(false);
  });
});

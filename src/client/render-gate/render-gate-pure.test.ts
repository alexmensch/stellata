import { describe, expect, it } from 'vitest';
import { ADAPT_SLEW_SETTLE_MAG } from '../hdr/exposure/scene-adaptation-pure';
import {
  POSE_SLOTS,
  SETTLE_MS,
  decideRender,
  exposureCutMoved,
  posesDiffer,
  rebasePoseTranslation,
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

describe('rebasePoseTranslation', () => {
  it('shifts position and target, and nothing else', () => {
    const p = pose();
    rebasePoseTranslation(p, 10, 20, 30);
    // Quaternion (3-6), fov (7) and worldOffset (11-13) must be untouched:
    // the only writer is the focal ride, which rotates nothing and never
    // moves the origin.
    expect(Array.from(p)).toEqual([11, 22, 33, 0, 0, 0, 1, 50, 14, 25, 36, 7, 8, 9]);
  });

  it('a rebased snapshot matches the pose the ride produced', () => {
    const before = pose();
    rebasePoseTranslation(before, 1e-11, 0, 0);
    const after = new Float64Array(POSE_SLOTS);
    writePose(
      after,
      { x: 1 + 1e-11, y: 2, z: 3 },
      { x: 0, y: 0, z: 0, w: 1 },
      50,
      { x: 4 + 1e-11, y: 5, z: 6 },
      { x: 7, y: 8, z: 9 },
    );
    expect(posesDiffer(before, after)).toBe(false);
  });

  it('a NaN-seeded snapshot stays NaN, so it still renders', () => {
    const p = new Float64Array(POSE_SLOTS).fill(Number.NaN);
    rebasePoseTranslation(p, 1, 2, 3);
    expect(posesDiffer(p, pose())).toBe(true);
  });
});

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

describe('exposureCutMoved', () => {
  it('the threshold is the exposure subsystem settle band', () => {
    expect(ADAPT_SLEW_SETTLE_MAG).toBe(1e-3);
  });

  it('an unseeded cut reads as moved', () => {
    expect(exposureCutMoved(-4.2, Number.NaN)).toBe(true);
  });

  it('holds at the band and moves past it', () => {
    // Anchored at 0 so the boundary is exact in float64 — at a realistic
    // cut, `dm ± band` does not round-trip to exactly the band.
    expect(exposureCutMoved(ADAPT_SLEW_SETTLE_MAG, 0)).toBe(false);
    expect(exposureCutMoved(-ADAPT_SLEW_SETTLE_MAG, 0)).toBe(false);
    expect(exposureCutMoved(2 * ADAPT_SLEW_SETTLE_MAG, 0)).toBe(true);
    expect(exposureCutMoved(-4.2 - 2 * ADAPT_SLEW_SETTLE_MAG, -4.2)).toBe(true);
  });

  it('the fp16 limit cycle never wakes the gate', () => {
    // The measured two-state alternation: uExposure 1.560e-3 ⇄ 1.561e-3
    // is 6.4e-4 relative, and uExposure ∝ 10^(0.4·dm).
    const jitter = 6.4e-4 / (0.4 * Math.LN10);
    const parked = -4.2;
    for (let frame = 0; frame < 100; frame++) {
      expect(exposureCutMoved(parked + (frame % 2) * jitter, parked)).toBe(false);
    }
  });

  it('sub-threshold steps all one way still wake it — the anchor is the last invalidate', () => {
    const step = ADAPT_SLEW_SETTLE_MAG / 4;
    let anchor = 0;
    let dm = 0;
    let woke = 0;
    for (let frame = 0; frame < 20; frame++) {
      dm -= step;
      if (exposureCutMoved(dm, anchor)) {
        anchor = dm;
        woke++;
      }
    }
    expect(woke).toBe(4);
  });
});

describe('decideRender', () => {
  const idle = { holds: 0, lastActiveMs: Number.NEGATIVE_INFINITY };
  const quiet = {
    continuous: false, poseChanged: false, cadenceDue: false, nowMs: 10_000,
  };

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

  it('a cadence frame renders WITHOUT stamping activity — no settle tail rides it', () => {
    const d = decideRender(idle, { ...quiet, cadenceDue: true });
    expect(d.render).toBe(true);
    expect(d.lastActiveMs).toBe(Number.NEGATIVE_INFINITY);
    // The very next quiet tick idles again.
    expect(decideRender(idle, { ...quiet, nowMs: 10_016 }).render).toBe(false);
  });
});

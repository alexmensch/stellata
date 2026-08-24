import { describe, expect, it } from 'vitest';
import { ADAPT_SLEW_SETTLE_MAG } from '../hdr/exposure/scene-adaptation-pure';
import { CADENCE_JND_FLUX_FRAC, CADENCE_JND_MAG } from './cadence/clock-cadence-pure';
import {
  POSE_SLOTS,
  SETTLE_MS,
  decideRender,
  exposureCutMoved,
  firstPoseDrift,
  ulpsBetween,
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
  it('the threshold is the cadence JND, not the exposure settle band', () => {
    expect(CADENCE_JND_MAG).toBe(0.01);
    // The band answers "is this numerically the same cut" and is 10.9x
    // tighter than anything a viewer resolves. Reinstating it as the wake
    // threshold is what pinned the gate open at a static vantage.
    expect(CADENCE_JND_MAG / ADAPT_SLEW_SETTLE_MAG).toBeCloseTo(10, 6);
  });

  it('the JND in magnitudes is the same 1% of flux, rounded down', () => {
    // Both constants state one perceptual claim in two units, so they
    // cannot drift apart. 1% of flux is 0.010912 mag of dimming; the
    // magnitudes form rounds to 0.01, which is the conservative side.
    expect(-2.5 * Math.log10(1 - CADENCE_JND_FLUX_FRAC)).toBeCloseTo(0.010912, 6);
    expect(CADENCE_JND_MAG).toBe(0.01);
  });

  it('an unseeded cut reads as moved', () => {
    expect(exposureCutMoved(-4.2, Number.NaN)).toBe(true);
  });

  it('holds at the JND and moves past it', () => {
    // Anchored at 0 so the boundary is exact in float64 — at a realistic
    // cut, `dm ± JND` does not round-trip to exactly the JND.
    expect(exposureCutMoved(CADENCE_JND_MAG, 0)).toBe(false);
    expect(exposureCutMoved(-CADENCE_JND_MAG, 0)).toBe(false);
    expect(exposureCutMoved(2 * CADENCE_JND_MAG, 0)).toBe(true);
    expect(exposureCutMoved(-4.2 - 2 * CADENCE_JND_MAG, -4.2)).toBe(true);
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

  it('a settle-band random walk never wakes the gate', () => {
    // The reported freeze: a cut hunting inside the exposure subsystem's
    // own band re-armed the tail every ~0.5s forever, because the anchor
    // re-seeds on each wake and turns a bounded oscillation into an
    // accumulator. At the JND the same walk stays quiet.
    let dm = -4.2;
    const anchor = dm;
    for (let frame = 0; frame < 2000; frame++) {
      dm += (frame % 2 === 0 ? 1 : -1) * ADAPT_SLEW_SETTLE_MAG;
      expect(exposureCutMoved(dm, anchor)).toBe(false);
    }
  });

  it('a real slew still wakes it on the first frame', () => {
    // Entering a bright scene ramps whole magnitudes; the wake must not
    // wait for the JND to accumulate.
    expect(exposureCutMoved(-0.5, 0)).toBe(true);
  });

  it('sub-threshold steps all one way still wake it — the anchor is the last invalidate', () => {
    const step = CADENCE_JND_MAG / 4;
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

  it('a cadence frame renders WITHOUT stamping activity', () => {
    const d = decideRender(idle, { ...quiet, cadenceDue: true });
    expect(d.render).toBe(true);
    // Stamping would drag the whole 1500 ms tail behind every scheduled
    // frame — about 90 extra frames at 60 Hz for each one the cadence
    // asked for, which is the entire idle the cadence exists to buy.
    expect(d.lastActiveMs).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('rebasePoseTranslation', () => {
  it('shifts position and target, leaving orientation, fov and origin', () => {
    const p = pose();
    rebasePoseTranslation(p, 0.5, -1, 2);
    expect(Array.from(p)).toEqual([1.5, 1, 5, 0, 0, 0, 1, 50, 4.5, 4, 8, 7, 8, 9]);
  });

  it('an absorbed ride step leaves the gate quiet across repeats', () => {
    const stored = pose();
    const live = pose();
    for (let frame = 0; frame < 6; frame++) {
      // The ride translates camera and target together, then hands the
      // same delta to the gate.
      live[0] += 0.25; live[1] += 0.25; live[2] += 0.25;
      live[8] += 0.25; live[9] += 0.25; live[10] += 0.25;
      rebasePoseTranslation(stored, 0.25, 0.25, 0.25);
      expect(posesDiffer(live, stored)).toBe(false);
    }
  });

  it('the SAME step unabsorbed wakes the gate on every ride — the regression', () => {
    const stored = pose();
    const live = pose();
    let wakes = 0;
    for (let frame = 0; frame < 6; frame++) {
      live[0] += 0.25; live[8] += 0.25;
      if (posesDiffer(live, stored)) wakes++;
    }
    expect(wakes).toBe(6);
  });

  it('a real camera move on top of an absorbed ride still wakes it', () => {
    const stored = pose();
    const live = pose();
    // The ride moved 0.25; the user dragged another 0.25 on top of it.
    live[0] += 0.5; live[8] += 0.25;
    rebasePoseTranslation(stored, 0.25, 0, 0);
    expect(posesDiffer(live, stored)).toBe(true);
  });

  it('touches the six translation slots and nothing else', () => {
    const before = pose();
    const after = pose();
    rebasePoseTranslation(after, 1, 1, 1);
    const moved: number[] = [];
    for (let i = 0; i < POSE_SLOTS; i++) if (before[i] !== after[i]) moved.push(i);
    // Orientation, fov and worldOffset stay: the only writer is the focal
    // ride, which translates camera and target together and rotates
    // nothing. Absorbing a rotation would hide a real camera move.
    expect(moved).toEqual([0, 1, 2, 8, 9, 10]);
  });

  it('a NaN-seeded snapshot stays unseeded through a rebase', () => {
    const seed = new Float64Array(POSE_SLOTS).fill(Number.NaN);
    rebasePoseTranslation(seed, 1, 1, 1);
    expect(posesDiffer(seed, pose())).toBe(true);
  });
});

describe('ulpsBetween', () => {
  it('identical values are zero steps apart, including across signed zero', () => {
    expect(ulpsBetween(1.5, 1.5)).toBe(0);
    expect(ulpsBetween(0, -0)).toBe(0);
  });

  it('adjacent representables are one step apart at any magnitude', () => {
    expect(ulpsBetween(1, 1 + Number.EPSILON)).toBe(1);
    expect(ulpsBetween(-1 - Number.EPSILON, -1)).toBe(1);
    // Scale-free, which is the property that makes the unit usable across
    // a pose holding both parsec coordinates and unit quaternions.
    for (const v of [1e-6, 4.2, 1e13]) {
      const next = v + Math.abs(v) * Number.EPSILON;
      expect(ulpsBetween(v, next)).toBe(1);
    }
  });

  it('counts steps across zero rather than exploding', () => {
    expect(ulpsBetween(Number.MIN_VALUE, -Number.MIN_VALUE)).toBe(2);
  });

  it('a NaN-seeded snapshot is a sentinel, not a drift', () => {
    expect(ulpsBetween(Number.NaN, 1)).toBeNaN();
    expect(ulpsBetween(1, Number.POSITIVE_INFINITY)).toBeNaN();
  });

  it('separates float non-convergence from real motion', () => {
    // The distinction the readout exists to draw. A quaternion component
    // re-derived each frame lands a few steps away; a body actually moving
    // across the screen is many orders more.
    const q = 0.8336940407752991;
    expect(ulpsBetween(q, q + 2 * Number.EPSILON * q)).toBeLessThan(16);
    expect(ulpsBetween(q, q + 1e-9)).toBeGreaterThan(1e6);
  });
});

describe('firstPoseDrift', () => {
  it('names the slot, in writePose order', () => {
    expect(firstPoseDrift(pose(), pose())).toBe(null);
    const b = pose();
    b[7] += 1;
    expect(firstPoseDrift(pose(), b)?.slot).toBe('fov');
    const c = pose();
    c[10] += 1;
    expect(firstPoseDrift(pose(), c)?.slot).toBe('target.z');
  });
});

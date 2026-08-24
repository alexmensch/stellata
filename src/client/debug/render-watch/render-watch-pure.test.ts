import { describe, expect, it } from 'vitest';
import { SETTLE_MS } from '../../render-gate/render-gate-pure';
import {
  CADENCE_CAP_SIM_S,
  CADENCE_JND_FLUX_FRAC,
  CADENCE_MOTION_THRESHOLD_DEVICE_PX,
  CADENCE_REPORT_STILL,
} from '../../render-gate/cadence/clock-cadence-pure';
import {
  GAP_SAMPLE_COUNT,
  STUCK_TAIL_MS,
  bindingSourceLabel,
  classifyHealth,
  classifyRenderWatch,
  hudContainerCss,
  medianOf,
  observedAsRate,
  poseDriftLabel,
  type RenderWatchSample,
} from './render-watch-pure';

const sample = (over: Partial<RenderWatchSample> = {}): RenderWatchSample => ({
  holds: 0,
  clockRate: 1,
  budgetSimS: CADENCE_CAP_SIM_S,
  msSinceWake: SETTLE_MS * 10,
  tailHeldMs: 0,
  gapsMs: [],
  trust: 1,
  violation: null,
  ...over,
});

describe('medianOf', () => {
  it('empty is NaN; otherwise the upper-middle element', () => {
    expect(Number.isNaN(medianOf([]))).toBe(true);
    expect(medianOf([5])).toBe(5);
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 3, 2])).toBe(3);
  });

  it('does not mutate the caller\'s array', () => {
    const gaps = [3, 1, 2];
    medianOf(gaps);
    expect(gaps).toEqual([3, 1, 2]);
  });
});

describe('the sample window', () => {
  it('is bounded by COUNT, not by wall-clock', () => {
    // The 120 s window it replaced meant a two-minute tail of 16 ms gaps
    // after any interaction, and a ~7200-element sort five times a second
    // while that tail lasted.
    expect(GAP_SAMPLE_COUNT).toBe(32);
  });

  it('the stuck-tail threshold is three settle tails', () => {
    expect(STUCK_TAIL_MS).toBe(3 * SETTLE_MS);
  });
});

describe('classifyRenderWatch', () => {
  it('a live under-report outranks every other verdict, and names itself', () => {
    const v = classifyRenderWatch(sample({
      holds: 3,
      trust: 0.125,
      violation: { channel: 'motion', observed: 4, allowed: 0.5, trust: 0.125 },
    }));
    expect(v.tone).toBe('wrong');
    expect(v.reason).toContain('UNDER-REPORTED');
    expect(v.reason).toContain('motion');
    expect(v.reason).toContain('1/8');
  });

  it('a recovered net does not keep shouting', () => {
    const v = classifyRenderWatch(sample({
      trust: 1,
      violation: { channel: 'motion', observed: 4, allowed: 0.5, trust: 0.5 },
      gapsMs: [30_000, 30_000],
    }));
    expect(v.tone).toBe('idling');
  });

  it('a hold is named before anything about the clock', () => {
    const v = classifyRenderWatch(sample({ holds: 2, clockRate: 0 }));
    expect(v.tone).toBe('held');
    expect(v.reason).toContain('2 hold');
  });

  it('a paused clock says the cadence is not what idles there', () => {
    const v = classifyRenderWatch(sample({ clockRate: 0 }));
    expect(v.tone).toBe('as-designed');
    expect(Number.isNaN(v.expectedGapMs)).toBe(true);
  });

  it('past live rate is as-designed, either direction', () => {
    for (const rate of [2, -2, 100]) {
      expect(classifyRenderWatch(sample({ clockRate: rate })).tone).toBe('as-designed');
    }
  });

  it('there is no idle-floor verdict any more', () => {
    // A 0.3 s budget used to read AS DESIGNED via the 2 s floor, which is
    // where the feature died at close vantages. Now it is just a short
    // schedule, and a 0.3 s median against it is idling.
    const v = classifyRenderWatch(sample({ budgetSimS: 0.3, gapsMs: [300, 305, 298] }));
    expect(v.tone).toBe('idling');
    expect(v.expectedGapMs).toBeCloseTo(300, 6);
  });

  it('a settle tail is transient; one that never expires is wrong', () => {
    expect(classifyRenderWatch(sample({ msSinceWake: 200 })).tone).toBe('transient');
    const stuck = classifyRenderWatch(sample({ msSinceWake: 200, tailHeldMs: STUCK_TAIL_MS }));
    expect(stuck.tone).toBe('wrong');
    expect(stuck.reason).toContain('TAIL NEVER EXPIRES');
  });

  it('too few gaps is honest about collecting rather than guessing', () => {
    const v = classifyRenderWatch(sample({ gapsMs: [30_000] }));
    expect(v.tone).toBe('unknown');
    expect(Number.isNaN(v.medianGapMs)).toBe(false);
  });

  it('gaps well under the expected one read as NOT IDLING', () => {
    const v = classifyRenderWatch(sample({ gapsMs: [16, 17, 16, 17] }));
    expect(v.tone).toBe('wrong');
    expect(v.reason).toContain('NOT IDLING');
  });

  it('the expected gap scales with the clock rate', () => {
    expect(classifyRenderWatch(sample({ budgetSimS: 30, clockRate: 1 })).expectedGapMs)
      .toBe(30_000);
    expect(classifyRenderWatch(sample({ budgetSimS: 30, clockRate: 0.5 })).expectedGapMs)
      .toBe(60_000);
  });
});

describe('bindingSourceLabel', () => {
  const still = CADENCE_REPORT_STILL;

  it('nothing moving lands on the cap', () => {
    expect(bindingSourceLabel(still, Number.POSITIVE_INFINITY, 2)).toContain('cap');
  });

  it('names motion when the pixel channel is tightest', () => {
    const r = { ...still, screenPxPerSimS: 1 };
    expect(bindingSourceLabel(r, Number.POSITIVE_INFINITY, 2)).toBe('on-screen motion');
  });

  it('names brightness when the flux channel is tightest', () => {
    const r = { ...still, screenPxPerSimS: 1e-6, fluxFracPerSimS: 1 };
    expect(bindingSourceLabel(r, Number.POSITIVE_INFINITY, 2)).toBe('a brightness ramp');
  });

  it('names the pulsation bound only when it undercuts the cap', () => {
    expect(bindingSourceLabel(still, 32.36, 2)).toContain('cap');
    expect(bindingSourceLabel(still, 12, 2)).toBe('the pulsation bound');
  });

  it('the label cannot disagree with the number beside it', () => {
    // Same reduction order as cadenceSimBudgetS: motion, flux, pulsation,
    // cap. A tie goes to the earlier one in both places.
    const motionOnly = { ...still, screenPxPerSimS: 1 };
    const budgetMotion = CADENCE_MOTION_THRESHOLD_DEVICE_PX / (1 * 2);
    expect(budgetMotion).toBeLessThan(CADENCE_JND_FLUX_FRAC / 1e-9);
    expect(bindingSourceLabel(motionOnly, Number.POSITIVE_INFINITY, 2))
      .toBe('on-screen motion');
  });
});

describe('observedAsRate', () => {
  it('converts a per-gap observation into the rate channels\' units', () => {
    // The readout prints this against `reported`, which is per sim second.
    expect(observedAsRate(9.89e-6, 0.0568)).toBeCloseTo(1.7412e-4, 8);
  });

  it('the reported freeze: normalised, the declaration was accurate', () => {
    // Copied from the bug report — 3836 frames over 218s, so a 56.8ms gap.
    // reported 1.68e-4 flux/s, observed 9.89e-6 per gap. The two rows read
    // three orders apart and the estimator was right to within 4%, which is
    // exactly why the raw per-gap number must never be printed beside a rate.
    expect(observedAsRate(9.89e-6, 218 / 3836) / 1.68e-4).toBeCloseTo(1.03588, 5);
  });

  it('a sign-flipped gap (the clock scrubbed backwards) still reads positive', () => {
    expect(observedAsRate(4, -2)).toBe(2);
  });

  it('no gap yet, and a zero-length gap, both read as no rate', () => {
    expect(observedAsRate(1, Number.NaN)).toBeNaN();
    expect(observedAsRate(1, 0)).toBeNaN();
  });
});

describe('poseDriftLabel', () => {
  it('names non-convergence when the move is a few representable steps', () => {
    const label = poseDriftLabel({ slot: 'quat.w', delta: 2.2e-16, ulps: 2 });
    expect(label).toContain('quat.w');
    expect(label).toContain('2 ulp');
    expect(label).toContain('NOT CONVERGING');
  });

  it('does not cry non-convergence at real motion', () => {
    const label = poseDriftLabel({ slot: 'pos.x', delta: 1.4e-9, ulps: 5.2e9 });
    expect(label).toContain('pos.x');
    expect(label).not.toContain('NOT CONVERGING');
  });

  it('the absolute delta alone cannot separate the two', () => {
    // Why the ULP column exists: both of these are far below anything a
    // viewer could see, and only one of them will ever settle.
    const stuck = poseDriftLabel({ slot: 'quat.w', delta: 1e-16, ulps: 1 });
    const moving = poseDriftLabel({ slot: 'quat.w', delta: 1e-12, ulps: 9e3 });
    expect(stuck).toContain('NOT CONVERGING');
    expect(moving).not.toContain('NOT CONVERGING');
  });

  it('a NaN-seeded first frame is labelled as such, not as a drift', () => {
    expect(poseDriftLabel({ slot: 'pos.x', delta: Number.NaN, ulps: Number.NaN }))
      .toContain('first frame');
  });

  it('no drift recorded still prints something', () => {
    expect(poseDriftLabel(null)).toBe('unknown slot');
  });
});

describe('classifyHealth', () => {
  it('a high skip ratio with slow ticks is the browser deferring', () => {
    expect(classifyHealth({ tickHz: 10, skipRatio: 0.9, hitches: 0, worstGapMs: 0 }))
      .toContain('deferring');
  });

  it('no skips with slow ticks is frame cost, not the gate', () => {
    expect(classifyHealth({ tickHz: 20, skipRatio: 0, hitches: 0, worstGapMs: 0 }))
      .toContain('50ms frames');
  });

  it('says nothing when both are healthy', () => {
    expect(classifyHealth({ tickHz: 60, skipRatio: 0.99, hitches: 0, worstGapMs: 0 }))
      .toBe('');
  });

  it('reports hitches alongside whichever confound applies', () => {
    expect(classifyHealth({ tickHz: 60, skipRatio: 0.5, hitches: 3, worstGapMs: 220 }))
      .toBe('3 hitches >100ms, worst 220ms');
  });
});

describe('hudContainerCss', () => {
  it('absorbs pointer events rather than passing them to the canvas', () => {
    // `none` would let every pointer move in this corner reach the canvas
    // and wake the very gate the HUD is watching.
    expect(hudContainerCss()).toContain('pointer-events:auto');
  });

  it('opts back into selection, with the -webkit- property written out', () => {
    const css = hudContainerCss();
    expect(css).toContain('user-select:text');
    expect(css).toContain('-webkit-user-select:text');
  });
});

import { describe, expect, it } from 'vitest';
import {
  CADENCE_CAP_SIM_S,
  CADENCE_JND_MAG,
  CADENCE_MIN_IDLE_GAP_REAL_S,
  CADENCE_MOTION_THRESHOLD_DEVICE_PX,
  cadenceBudgetFromRatePxS,
  cadenceSimBudgetS,
  clockFrameDue,
  pulsationCadenceBudgetS,
} from './clock-cadence-pure';

describe('the constants', () => {
  it('are pinned', () => {
    expect(CADENCE_CAP_SIM_S).toBe(30);
    expect(CADENCE_MOTION_THRESHOLD_DEVICE_PX).toBe(0.5);
    expect(CADENCE_JND_MAG).toBe(0.01);
  });

  it('the cap holds a fast eclipser-free variable under a JND-scale step', () => {
    // A δ Scuti at P = 0.05 d, A = 0.2 mag — near the fast end of the
    // GCVS population — slopes at A·π/P; the cap's worth of sim time
    // moves it ~0.044 mag. The catalog-derived pulsation budget below is
    // what tightens past this for anything faster.
    const slope = (0.2 * Math.PI) / (0.05 * 86400);
    expect(slope * CADENCE_CAP_SIM_S).toBeLessThan(0.05);
  });
});

describe('pulsationCadenceBudgetS', () => {
  it('the fastest unsuppressed variable sets the budget', () => {
    const periods = [332, 0.05, 2.87];
    const amps = [1.0, 0.2, 1.3];
    // Fastest slope: the δ Scuti row — 0.2·π over 0.05 d.
    const expected = CADENCE_JND_MAG / ((0.2 * Math.PI) / (0.05 * 86400));
    expect(pulsationCadenceBudgetS(periods, amps)).toBeCloseTo(expected, 12);
    // Suppressing it hands the budget to the next-fastest (the eclipser
    // row is suppressed too — eclipsers never pulsate).
    const suppress = [0, 1, 1];
    const mira = CADENCE_JND_MAG / ((1.0 * Math.PI) / (332 * 86400));
    expect(pulsationCadenceBudgetS(periods, amps, suppress)).toBeCloseTo(mira, 9);
  });

  it('no pulsating variable → Infinity', () => {
    expect(pulsationCadenceBudgetS([0, 0], [0, 0.5])).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('cadenceBudgetFromRatePxS', () => {
  it('a still layer constrains nothing', () => {
    expect(cadenceBudgetFromRatePxS(0, 1)).toBe(Number.POSITIVE_INFINITY);
  });

  it('the threshold is device pixels: a denser display halves the budget', () => {
    expect(cadenceBudgetFromRatePxS(0.25, 1)).toBe(2);
    expect(cadenceBudgetFromRatePxS(0.25, 2)).toBe(1);
    expect(cadenceBudgetFromRatePxS(0.25, 3)).toBeCloseTo(2 / 3, 12);
  });

  it('a sub-unity ratio never buys extra budget', () => {
    expect(cadenceBudgetFromRatePxS(0.25, 0.5)).toBe(2);
  });
});

describe('cadenceSimBudgetS', () => {
  it('the cap bounds every budget', () => {
    expect(cadenceSimBudgetS(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY))
      .toBe(CADENCE_CAP_SIM_S);
    expect(cadenceSimBudgetS(4, 900)).toBe(4);
    expect(cadenceSimBudgetS(900, 4)).toBe(4);
    expect(cadenceSimBudgetS(0, 900)).toBe(0);
  });
});

describe('clockFrameDue', () => {
  it('a paused clock is never due, whatever the budget', () => {
    expect(clockFrameDue(0, 100, Number.NaN, 0)).toBe(false);
  });

  it('nothing rendered yet is due', () => {
    expect(clockFrameDue(1, 100, Number.NaN, 30)).toBe(true);
  });

  it('due exactly at the budget, either clock direction', () => {
    expect(clockFrameDue(1, 129.9, 100, 30)).toBe(false);
    expect(clockFrameDue(1, 130, 100, 30)).toBe(true);
    expect(clockFrameDue(-1, 70.1, 100, 30)).toBe(false);
    expect(clockFrameDue(-1, 70, 100, 30)).toBe(true);
  });

  it('a zero budget renders every tick under any running rate', () => {
    expect(clockFrameDue(1e-9, 100, 100, 0)).toBe(true);
  });

  it('faster than live never idles, whatever the budget allows', () => {
    // The whole cap's worth of budget at 2x is a 15 s hold — bounded to
    // half a device pixel of motion and still a hang to whoever pressed
    // fast-forward. Every rate past live renders every tick.
    expect(clockFrameDue(2, 100, 100, CADENCE_CAP_SIM_S)).toBe(true);
    expect(clockFrameDue(-64, 100, 100, CADENCE_CAP_SIM_S)).toBe(true);
    expect(clockFrameDue(1.0001, 100, 100, CADENCE_CAP_SIM_S)).toBe(true);
    // Live itself still idles — the boundary belongs to the idling side.
    expect(clockFrameDue(1, 100, 100, CADENCE_CAP_SIM_S)).toBe(false);
    expect(clockFrameDue(-1, 100, 100, CADENCE_CAP_SIM_S)).toBe(false);
  });

  it('a gap too short to be worth idling renders every tick', () => {
    expect(CADENCE_MIN_IDLE_GAP_REAL_S).toBe(2);
    // At live rate the budget IS the gap in real seconds. A vantage whose
    // fastest driver allows just under it renders continuously rather
    // than holding a frame for that long.
    expect(clockFrameDue(1, 100, 100, CADENCE_MIN_IDLE_GAP_REAL_S - 0.01)).toBe(true);
    // At the threshold it idles, and stays skipping until the budget.
    expect(clockFrameDue(1, 101, 100, CADENCE_MIN_IDLE_GAP_REAL_S)).toBe(false);
    expect(clockFrameDue(1, 102, 100, CADENCE_MIN_IDLE_GAP_REAL_S)).toBe(true);
    // Half rate doubles the real gap, so half the budget still clears it.
    expect(clockFrameDue(0.5, 100, 100, 1)).toBe(false);
    expect(clockFrameDue(0.5, 100, 100, 0.99)).toBe(true);
  });

  it('a NaN budget renders rather than freezing the clock', () => {
    // The registry drops a NaN layer budget before it reaches here; this
    // pins that the gate survives one arriving anyway. `elapsed >= NaN`
    // is false forever, so the naive form would never fire again.
    expect(clockFrameDue(1, 1e9, 100, Number.NaN)).toBe(true);
  });

  it('an unconstrained budget never fires a cadence frame', () => {
    // Nothing drawn rides the clock: no layer reported, no variable
    // pulsates. The cap normally floors this at 30 s — the gate itself
    // must not invent a frame when it does not.
    expect(clockFrameDue(1, 1e9, 100, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

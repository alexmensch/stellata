import { describe, expect, it } from 'vitest';
import {
  CADENCE_CAP_SIM_S,
  CADENCE_JND_FLUX_FRAC,
  CADENCE_JND_MAG,
  CADENCE_MOTION_THRESHOLD_DEVICE_PX,
  CADENCE_REPORT_STILL,
  CADENCE_SAFETY_FACTOR,
  CADENCE_VISIBLE_STEP_DEVICE_PX,
  cadenceSimBudgetS,
  cadenceVisibleTurnRad,
  clockFrameDue,
  fasterRate,
  maxCadenceReport,
  pulsationCadenceBudgetS,
  type CadenceReport,
} from './clock-cadence-pure';

const report = (over: Partial<CadenceReport> = {}): CadenceReport =>
  ({ ...CADENCE_REPORT_STILL, ...over });

describe('the thresholds', () => {
  it('the scheduling threshold is the visible step over the safety factor', () => {
    expect(CADENCE_VISIBLE_STEP_DEVICE_PX).toBe(0.5);
    expect(CADENCE_SAFETY_FACTOR).toBe(2);
    expect(CADENCE_MOTION_THRESHOLD_DEVICE_PX).toBe(0.25);
  });

  it('a JND is one percent in both units', () => {
    expect(CADENCE_JND_FLUX_FRAC).toBe(0.01);
    expect(CADENCE_JND_MAG).toBe(0.01);
  });

  it('the cap is 30 sim seconds', () => {
    expect(CADENCE_CAP_SIM_S).toBe(30);
  });
});

describe('cadenceVisibleTurnRad', () => {
  // The pinned vantage the budgets are all quoted at: 900 CSS px of viewport
  // height, 50° vertical FOV, 16:9, device ratio 2.
  const PX_PER_RADIAN = 1031.32;

  it('is the scheduling threshold in radians at the pinned vantage', () => {
    const turn = cadenceVisibleTurnRad(PX_PER_RADIAN, 2);
    expect(turn).toBeCloseTo(CADENCE_MOTION_THRESHOLD_DEVICE_PX / (PX_PER_RADIAN * 2), 15);
    expect((turn * 180) / Math.PI).toBeCloseTo(0.0069445, 7);
  });

  it('halves when the display doubles its device pixels', () => {
    expect(cadenceVisibleTurnRad(PX_PER_RADIAN, 2) * 2)
      .toBeCloseTo(cadenceVisibleTurnRad(PX_PER_RADIAN, 1), 15);
  });

  // Zero means "no step is too small", so a viewport that has not resolved
  // yet writes every frame rather than freezing whatever reads this.
  it('answers zero for a degenerate viewport rather than infinity', () => {
    expect(cadenceVisibleTurnRad(0, 2)).toBe(0);
    expect(cadenceVisibleTurnRad(PX_PER_RADIAN, 0)).toBe(0);
  });
});

describe('fasterRate / maxCadenceReport', () => {
  it('takes the larger, and NaN never wins', () => {
    expect(fasterRate(1, 2)).toBe(2);
    expect(fasterRate(2, 1)).toBe(2);
    expect(fasterRate(2, Number.NaN)).toBe(2);
    expect(fasterRate(Number.NaN, 2)).toBe(2);
    // Both NaN is the only way it survives at all.
    expect(Number.isNaN(fasterRate(Number.NaN, Number.NaN))).toBe(true);
  });

  it('reduces each of the four channels independently', () => {
    const out = maxCadenceReport(
      report({ screenPxPerSimS: 5, fluxFracPerSimS: 0.001, observedPx: 0.4 }),
      report({ screenPxPerSimS: 1, fluxFracPerSimS: 0.02, observedFluxFrac: 0.7 }),
    );
    expect(out).toEqual({
      screenPxPerSimS: 5,
      fluxFracPerSimS: 0.02,
      observedPx: 0.4,
      observedFluxFrac: 0.7,
    });
  });
});

describe('cadenceSimBudgetS', () => {
  it('nothing moving lands on the cap', () => {
    expect(cadenceSimBudgetS(CADENCE_REPORT_STILL, Number.POSITIVE_INFINITY, 2))
      .toBe(CADENCE_CAP_SIM_S);
  });

  it('the pixel ratio is applied ONCE, here and nowhere else', () => {
    // A layer reports CSS px; a device pixel at ratio 2 is half a CSS px,
    // so the same reported rate buys half the budget.
    const r = report({ screenPxPerSimS: 1 });
    expect(cadenceSimBudgetS(r, Number.POSITIVE_INFINITY, 1)).toBeCloseTo(0.25, 12);
    expect(cadenceSimBudgetS(r, Number.POSITIVE_INFINITY, 2)).toBeCloseTo(0.125, 12);
  });

  it('a sub-1 pixel ratio cannot lengthen the budget', () => {
    const r = report({ screenPxPerSimS: 1 });
    expect(cadenceSimBudgetS(r, Number.POSITIVE_INFINITY, 0.5))
      .toBe(cadenceSimBudgetS(r, Number.POSITIVE_INFINITY, 1));
  });

  it('the brightness channel binds when it is the tighter one', () => {
    const r = report({ screenPxPerSimS: 0.001, fluxFracPerSimS: 0.05 });
    // 0.01 / 0.05 = 0.2 s, against 0.25 / (0.001 * 2) = 125 s on motion.
    expect(cadenceSimBudgetS(r, Number.POSITIVE_INFINITY, 2)).toBeCloseTo(0.2, 12);
  });

  it('the pulsation bound binds only when it undercuts the cap', () => {
    expect(cadenceSimBudgetS(CADENCE_REPORT_STILL, 32.36, 2)).toBe(CADENCE_CAP_SIM_S);
    expect(cadenceSimBudgetS(CADENCE_REPORT_STILL, 12, 2)).toBe(12);
  });

  it('trust multiplies the result, so a wrong declaration shortens it', () => {
    expect(cadenceSimBudgetS(CADENCE_REPORT_STILL, Number.POSITIVE_INFINITY, 2, 0.25))
      .toBe(CADENCE_CAP_SIM_S / 4);
  });
});

describe('pulsationCadenceBudgetS', () => {
  it('the fastest variable bounds every other', () => {
    // Slope peaks at A·pi/P; the JND over it is the budget.
    const budget = pulsationCadenceBudgetS([1, 10], [0.5, 2]);
    const fastest = (0.5 * Math.PI) / 86400;
    expect(budget).toBeCloseTo(CADENCE_JND_MAG / fastest, 9);
  });

  it('a catalogue with no pulsator never binds', () => {
    expect(pulsationCadenceBudgetS([0, 5], [1, 0])).toBe(Number.POSITIVE_INFINITY);
    expect(pulsationCadenceBudgetS([], [])).toBe(Number.POSITIVE_INFINITY);
  });

  it('suppressed records are excluded — an eclipser never pulsates', () => {
    const p = [0.1, 40];
    const a = [1, 0.2];
    const unmasked = pulsationCadenceBudgetS(p, a);
    const masked = pulsationCadenceBudgetS(p, a, [1, 0]);
    expect(masked).toBeGreaterThan(unmasked);
    expect(masked).toBeCloseTo(CADENCE_JND_MAG / ((0.2 * Math.PI) / (40 * 86400)), 6);
  });

  it('the mask is read at 0.5, matching the float attribute it comes from', () => {
    const p = [0.1];
    const a = [1];
    expect(pulsationCadenceBudgetS(p, a, [0.4])).toBeLessThan(Number.POSITIVE_INFINITY);
    expect(pulsationCadenceBudgetS(p, a, [0.5])).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('clockFrameDue', () => {
  const now = 1e9;

  it('a paused clock is never due, whatever the budget', () => {
    expect(clockFrameDue(0, now, Number.NaN, 0)).toBe(false);
    expect(clockFrameDue(0, now + 1e6, now, 1)).toBe(false);
  });

  it('nothing rendered yet is due', () => {
    expect(clockFrameDue(1, now, Number.NaN, 30)).toBe(true);
  });

  it('faster than live never idles', () => {
    expect(clockFrameDue(2, now, now, 30)).toBe(true);
    expect(clockFrameDue(-2, now, now, 30)).toBe(true);
    expect(clockFrameDue(1, now, now, 30)).toBe(false);
    expect(clockFrameDue(-1, now, now, 30)).toBe(false);
  });

  it('a NaN or non-positive budget renders rather than freezing the clock', () => {
    expect(clockFrameDue(1, now, now, Number.NaN)).toBe(true);
    expect(clockFrameDue(1, now, now, 0)).toBe(true);
    expect(clockFrameDue(1, now, now, -5)).toBe(true);
  });

  it('due at or past the budget, and one tick of overshoot is all it costs', () => {
    expect(clockFrameDue(1, now + 4.32, now, 4.335)).toBe(false);
    expect(clockFrameDue(1, now + 4.4, now, 4.335)).toBe(true);
  });

  it('the boundary is exact only to the model clock\'s float64 resolution', () => {
    // `t` is Unix seconds, so around 1.8e9 one ULP is ~2.4e-7 s and the
    // elapsed difference is quantised to it. The due test is therefore
    // late by at most that, which is five orders under one rAF tick — but
    // it is why an equality assertion at the boundary is not a thing to
    // write here.
    expect(clockFrameDue(1, now + 0.3, now, 0.3)).toBe(false);
    expect(clockFrameDue(1, now + 0.3 + 1e-6, now, 0.3)).toBe(true);
    expect((now + 0.3) - now).toBeCloseTo(0.3, 6);
  });

  it('a clock running backwards idles on the same budget', () => {
    expect(clockFrameDue(-1, now - 4.32, now, 4.335)).toBe(false);
    expect(clockFrameDue(-1, now - 4.4, now, 4.335)).toBe(true);
  });

  it('there is no minimum idle gap — a short budget still schedules', () => {
    // The abandoned first attempt collapsed to continuous rendering below
    // a 2 s floor, which is where the whole feature died at close
    // vantages. A 0.3 s budget now means a frame every 0.3 s.
    expect(clockFrameDue(1, now + 0.2, now, 0.3)).toBe(false);
    expect(clockFrameDue(1, now + 0.31, now, 0.3)).toBe(true);
    expect(clockFrameDue(1, now + 0.05, now, 0.04)).toBe(true);
  });
});

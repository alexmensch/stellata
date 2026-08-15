import { beforeEach, describe, expect, it } from 'vitest';
import { exposureForMagLimit, MAG_PER_STOP } from './exposure-epoch';
import type { ReducedStatistic } from './reduction/reduction-pass';
import { tonemapWhitePoint } from '../tonemap-pure';
import { SceneAdaptation } from './scene-adaptation';
import {
  adaptationDm,
  ADAPT_DISPLAY_FLOOR_DM,
  ADAPT_SLEW_TAU_S,
  DEFAULT_ADAPTATION_TUNING,
  DISC_PEAK_OVER_MEAN,
  displayFloorDm,
  eyeAdaptationDm,
  L_ADAPT,
  L_CAP,
} from './scene-adaptation-pure';

const BASE_EXPOSURE = exposureForMagLimit(7.8);

/** A frame holding one body of disc-mean luminance `discMeanL` over
 *  `coverage` of the pixels, as the reduction would return it. The peak
 *  rides the mean rather than being free: a buffer max cannot come out
 *  below the buffer mean, so the two branches are never fed a pair the
 *  frame could not produce. */
function frame(discMeanL: number, coverage: number): ReducedStatistic {
  return {
    meanL: discMeanL * coverage,
    peakL: discMeanL * DISC_PEAK_OVER_MEAN,
    renderExposure: BASE_EXPOSURE,
  };
}

/** Coverage far under the guard handover, so the perception branch is the
 *  one being exercised. */
const POINT_COVERAGE = 1e-3;

let reduced: ReducedStatistic | null;
let base: number;
let whitePoint: number;

function makeAdaptation(): SceneAdaptation {
  return new SceneAdaptation({
    baseExposure: () => base,
    reduced: () => reduced,
    whitePoint: () => whitePoint,
  });
}

const SETTLE_FRAMES = 200;
const SETTLE_STEP_MS = 1000 * ADAPT_SLEW_TAU_S;
/** Wall clock the last `settle` frame ran at, so a follow-up frame can
 *  hand the slew a realistic dt rather than the clamp. */
const SETTLED_MS = (SETTLE_FRAMES - 1) * SETTLE_STEP_MS;

/** Run the one-pole slew out to its settle band — an exponential never
 *  arrives, so what lands the value is `ADAPT_SLEW_SETTLE_MAG`. */
function settle(adaptation: SceneAdaptation, chart = false): number {
  let dm = 0;
  for (let i = 0; i < SETTLE_FRAMES; i++) {
    dm = adaptation.measure(chart, i * SETTLE_STEP_MS, false);
  }
  return dm;
}

beforeEach(() => {
  reduced = null;
  base = BASE_EXPOSURE;
  whitePoint = tonemapWhitePoint();
});

describe('SceneAdaptation', () => {
  it('reports no cut before the first measurement lands', () => {
    const adaptation = makeAdaptation();
    expect(settle(adaptation)).toBe(0);
    expect(adaptation.getMeanLuminance()).toBe(0);
    expect(adaptation.getPeakLuminance()).toBe(0);
  });

  it('cuts on the reduced mean once it does', () => {
    const adaptation = makeAdaptation();
    reduced = frame(100 * L_ADAPT / POINT_COVERAGE, POINT_COVERAGE);
    expect(settle(adaptation)).toBeCloseTo(eyeAdaptationDm(100 * L_ADAPT), 6);
    expect(adaptation.getMeanLuminance()).toBeCloseTo(100 * L_ADAPT, 9);
  });

  it('divides out the exposure the frame was rendered with', () => {
    // The attachment carries the live adapted scalar; the statistic has to
    // read at the base one, or the loop feeds itself. Four magnitudes of
    // cut in the render exposure must leave the measurement unmoved.
    const adaptation = makeAdaptation();
    const cutExposure = BASE_EXPOSURE * 10 ** (0.4 * -4);
    reduced = {
      meanL: L_ADAPT * (cutExposure / BASE_EXPOSURE),
      peakL: L_CAP * (cutExposure / BASE_EXPOSURE),
      renderExposure: cutExposure,
    };
    expect(adaptation.measure(false, 0, false)).toBe(0);
    expect(adaptation.getMeanLuminance()).toBeCloseTo(L_ADAPT, 9);
  });

  it('lets the guard raise the exposure but never lower it', () => {
    const adaptation = makeAdaptation();
    // A body filling most of the frame: coverage is above the handover, so
    // the guard governs and the cut is SHALLOWER than the eye branch alone.
    reduced = frame(100 * L_ADAPT, 0.9);
    const withPeak = settle(adaptation);
    expect(withPeak).toBeCloseTo(adaptationDm(reduced.meanL, reduced.peakL), 6);
    expect(withPeak).toBeGreaterThan(eyeAdaptationDm(reduced.meanL));
  });

  it('leaves a peak under the cap alone', () => {
    const adaptation = makeAdaptation();
    reduced = frame(0.5 * L_CAP / DISC_PEAK_OVER_MEAN, 1);
    expect(settle(adaptation)).toBe(0);
  });

  it('slews toward a changed measurement rather than stepping to it', () => {
    const adaptation = makeAdaptation();
    reduced = frame(L_ADAPT / POINT_COVERAGE, POINT_COVERAGE);
    expect(settle(adaptation)).toBe(0);
    reduced = frame(1e4 * L_ADAPT / POINT_COVERAGE, POINT_COVERAGE);
    const target = adaptationDm(reduced.meanL, reduced.peakL);
    const first = adaptation.measure(false, SETTLED_MS + 16, false);
    expect(first).toBeLessThan(0);
    expect(first).toBeGreaterThan(target);
    expect(settle(adaptation)).toBeCloseTo(target, 6);
  });

  it('snaps under warp instead of ramping from the old scene', () => {
    const adaptation = makeAdaptation();
    reduced = frame(1e4 * L_ADAPT / POINT_COVERAGE, POINT_COVERAGE);
    adaptation.measure(false, 0, false);
    expect(adaptation.measure(false, 16, true))
      .toBeCloseTo(adaptationDm(reduced.meanL, reduced.peakL), 9);
  });

  it('measures nothing in chart mode, and re-enters the scene snapped', () => {
    const adaptation = makeAdaptation();
    reduced = frame(1e4 * L_ADAPT / POINT_COVERAGE, POINT_COVERAGE);
    settle(adaptation);
    expect(adaptation.measure(true, 1e6, false)).toBe(0);
    expect(adaptation.getMeanLuminance()).toBe(0);
    // lastNowMs dropped with the reset, so the first scene frame back is a
    // full blend rather than a ramp up from chart's zero cut.
    expect(adaptation.measure(false, 1e6 + 16, false))
      .toBeCloseTo(adaptationDm(reduced.meanL, reduced.peakL), 9);
  });

  it('reads against the live instrument exposure, not a fixed one', () => {
    const adaptation = makeAdaptation();
    reduced = frame(100 * L_ADAPT / POINT_COVERAGE, POINT_COVERAGE);
    settle(adaptation);
    const atDefault = adaptation.getMeanLuminance();
    base = exposureForMagLimit(12.8);
    adaptation.measure(false, 1e6, false);
    expect(adaptation.getMeanLuminance() / atDefault)
      .toBeCloseTo(exposureForMagLimit(12.8) / BASE_EXPOSURE, 6);
  });
});

// The pure branch layer takes a tuning argument; these pin that the class
// actually threads the panel's overrides into the cut it applies, which is
// the half a miswiring would leave silent.
describe('SceneAdaptation — the panel overrides', () => {
  it('rounds the levels back out for the sliders to seed from', () => {
    const adaptation = makeAdaptation();
    adaptation.setLAdapt(2 * L_ADAPT);
    adaptation.setLCap(2 * L_CAP);
    adaptation.setSlewTauS(4 * ADAPT_SLEW_TAU_S);
    expect(adaptation.getLAdapt()).toBe(2 * L_ADAPT);
    expect(adaptation.getLCap()).toBe(2 * L_CAP);
    expect(adaptation.getSlewTauS()).toBe(4 * ADAPT_SLEW_TAU_S);
    expect(adaptation.getTuning())
      .toEqual({ lAdapt: 2 * L_ADAPT, lCap: 2 * L_CAP, whitePoint });
  });

  it('decomposes the frame it actually ran, not a recomputed one', () => {
    const adaptation = makeAdaptation();
    reduced = frame(100 * L_ADAPT / POINT_COVERAGE, POINT_COVERAGE);
    adaptation.setLAdapt(2 * L_ADAPT);
    adaptation.measure(false, 0, false);
    expect(adaptation.branches().dm).toBe(adaptation.getDm());
  });

  it('applies a swept L_ADAPT to an eye-governed cut', () => {
    reduced = frame(100 * L_ADAPT / POINT_COVERAGE, POINT_COVERAGE);
    const shipped = settle(makeAdaptation());
    const swept = makeAdaptation();
    swept.setLAdapt(2 * L_ADAPT);
    expect(settle(swept)).toBeCloseTo(shipped + MAG_PER_STOP, 6);
  });

  it('applies a swept L_CAP to a guard-governed cut', () => {
    reduced = frame(100 * L_ADAPT, 0.9);
    const shipped = settle(makeAdaptation());
    const swept = makeAdaptation();
    swept.setLCap(2 * L_CAP);
    expect(settle(swept)).toBeCloseTo(shipped + MAG_PER_STOP, 6);
  });

  it('ramps at the slew tau it was given', () => {
    const fast = makeAdaptation();
    const slow = makeAdaptation();
    slow.setSlewTauS(4 * ADAPT_SLEW_TAU_S);
    reduced = frame(L_ADAPT / POINT_COVERAGE, POINT_COVERAGE);
    expect(settle(fast)).toBe(0);
    expect(settle(slow)).toBe(0);
    reduced = frame(1e4 * L_ADAPT / POINT_COVERAGE, POINT_COVERAGE);
    const fastStep = fast.measure(false, SETTLED_MS + 16, false);
    const slowStep = slow.measure(false, SETTLED_MS + 16, false);
    expect(slowStep).toBeLessThan(0);
    expect(fastStep).toBeLessThan(slowStep);
  });

  // The floor is derived from the white point, so a swept DR_MAG has to
  // reach the applied cut through the dep and not through the constant.
  it('cuts to the display floor the live white point implies', () => {
    reduced = frame(1e4 * L_ADAPT / POINT_COVERAGE, POINT_COVERAGE);
    expect(settle(makeAdaptation())).toBeCloseTo(ADAPT_DISPLAY_FLOOR_DM, 6);
    whitePoint = tonemapWhitePoint(11);
    const swept = settle(makeAdaptation());
    expect(swept)
      .toBeCloseTo(displayFloorDm({ ...DEFAULT_ADAPTATION_TUNING, whitePoint }), 6);
    expect(swept - ADAPT_DISPLAY_FLOOR_DM).toBeCloseTo(-3.5, 1);
  });
});

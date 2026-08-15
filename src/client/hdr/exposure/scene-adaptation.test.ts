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
  displayFloorDm,
  eyeAdaptationDm,
  L_ADAPT,
  L_TARGET,
} from './scene-adaptation-pure';

const BASE_EXPOSURE = exposureForMagLimit(7.8);

/** A frame holding one body of disc-mean luminance `discMeanL` over
 *  `coverage` of the pixels, as the reduction would return it: every lit
 *  texel belongs to that body, so the masked mean is the frame mean. */
function frame(discMeanL: number, coverage: number): ReducedStatistic {
  return {
    meanL: discMeanL * coverage,
    surfaceL: discMeanL * coverage,
    coverage,
    renderExposure: BASE_EXPOSURE,
  };
}

/** Coverage far under the ramp's foot, so the perception branch is the one
 *  being exercised. */
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

/** The pure branch layer's answer for the frame the class was handed. */
function target(): number {
  if (reduced === null) return 0;
  return adaptationDm(reduced);
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
    expect(adaptation.getStatistic().meanL).toBe(0);
    expect(adaptation.getStatistic()).toEqual({ meanL: 0, surfaceL: 0, coverage: 0 });
  });

  it('cuts on the reduced mean once it does', () => {
    const adaptation = makeAdaptation();
    reduced = frame(100 * L_ADAPT / POINT_COVERAGE, POINT_COVERAGE);
    expect(settle(adaptation)).toBeCloseTo(eyeAdaptationDm(100 * L_ADAPT), 6);
    expect(adaptation.getStatistic().meanL).toBeCloseTo(100 * L_ADAPT, 9);
  });

  it('divides out the exposure the frame was rendered with', () => {
    // The attachment carries the live adapted scalar; the statistic has to
    // read at the base one, or the loop feeds itself. Four magnitudes of
    // cut in the render exposure must leave the measurement unmoved — and
    // the coverage channel is a fraction, so it must NOT be rescaled.
    const adaptation = makeAdaptation();
    const cutExposure = BASE_EXPOSURE * 10 ** (0.4 * -4);
    reduced = {
      meanL: L_ADAPT * (cutExposure / BASE_EXPOSURE),
      surfaceL: L_ADAPT * (cutExposure / BASE_EXPOSURE),
      coverage: 0.3,
      renderExposure: cutExposure,
    };
    expect(adaptation.measure(false, 0, false)).toBe(0);
    expect(adaptation.getStatistic().meanL).toBeCloseTo(L_ADAPT, 9);
    expect(adaptation.getStatistic().coverage).toBe(0.3);
  });

  it('takes the pin where a surface dominates, shallower than the eye alone', () => {
    const adaptation = makeAdaptation();
    // A body filling most of the frame: over the ramp, so the pin governs
    // and holds the disc at L_TARGET instead of following the frame mean
    // down — which is what stops an approach dimming it.
    reduced = frame(100 * L_ADAPT, 0.9);
    const pinned = settle(adaptation);
    expect(pinned).toBeCloseTo(target(), 6);
    expect(pinned).toBeGreaterThan(eyeAdaptationDm(reduced.meanL));
    expect(100 * L_ADAPT * 10 ** (0.4 * pinned)).toBeCloseTo(L_TARGET, 6);
  });

  it('leaves a surface under the target alone', () => {
    const adaptation = makeAdaptation();
    reduced = frame(0.5 * L_TARGET, 1);
    expect(settle(adaptation)).toBe(0);
  });

  it('slews toward a changed measurement rather than stepping to it', () => {
    const adaptation = makeAdaptation();
    reduced = frame(L_ADAPT / POINT_COVERAGE, POINT_COVERAGE);
    expect(settle(adaptation)).toBe(0);
    reduced = frame(1e4 * L_ADAPT / POINT_COVERAGE, POINT_COVERAGE);
    const settled = target();
    const first = adaptation.measure(false, SETTLED_MS + 16, false);
    expect(first).toBeLessThan(0);
    expect(first).toBeGreaterThan(settled);
    expect(settle(adaptation)).toBeCloseTo(settled, 6);
  });

  it('snaps under warp instead of ramping from the old scene', () => {
    const adaptation = makeAdaptation();
    reduced = frame(1e4 * L_ADAPT / POINT_COVERAGE, POINT_COVERAGE);
    adaptation.measure(false, 0, false);
    expect(adaptation.measure(false, 16, true)).toBeCloseTo(target(), 9);
  });

  it('measures nothing in chart mode, and re-enters the scene snapped', () => {
    const adaptation = makeAdaptation();
    reduced = frame(1e4 * L_ADAPT / POINT_COVERAGE, POINT_COVERAGE);
    settle(adaptation);
    expect(adaptation.measure(true, 1e6, false)).toBe(0);
    expect(adaptation.getStatistic().meanL).toBe(0);
    // lastNowMs dropped with the reset, so the first scene frame back is a
    // full blend rather than a ramp up from chart's zero cut.
    expect(adaptation.measure(false, 1e6 + 16, false)).toBeCloseTo(target(), 9);
  });

  it('reads against the live instrument exposure, not a fixed one', () => {
    const adaptation = makeAdaptation();
    reduced = frame(100 * L_ADAPT / POINT_COVERAGE, POINT_COVERAGE);
    settle(adaptation);
    const atDefault = adaptation.getStatistic().meanL;
    base = exposureForMagLimit(12.8);
    adaptation.measure(false, 1e6, false);
    expect(adaptation.getStatistic().meanL / atDefault)
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
    adaptation.setLTarget(2 * L_TARGET);
    adaptation.setSlewTauS(4 * ADAPT_SLEW_TAU_S);
    expect(adaptation.getLAdapt()).toBe(2 * L_ADAPT);
    expect(adaptation.getLTarget()).toBe(2 * L_TARGET);
    expect(adaptation.getSlewTauS()).toBe(4 * ADAPT_SLEW_TAU_S);
    expect(adaptation.getTuning())
      .toEqual({ lAdapt: 2 * L_ADAPT, lTarget: 2 * L_TARGET, whitePoint });
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

  it('applies a swept L_TARGET to a pin-governed cut', () => {
    reduced = frame(100 * L_ADAPT, 0.9);
    const shipped = settle(makeAdaptation());
    const swept = makeAdaptation();
    swept.setLTarget(2 * L_TARGET);
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

import { beforeEach, describe, expect, it } from 'vitest';
import { exposureForMagLimit, MAG_PER_STOP } from './exposure-epoch';
import type { ReducedStatistic } from './reduction/reduction-pass';
import { tonemapWhitePoint } from '../tonemap-pure';
import { SceneAdaptation } from './scene-adaptation';
import {
  adaptationDm,
  ADAPT_DISPLAY_FLOOR_DM,
  ADAPT_SLEW_SETTLE_MAG,
  ADAPT_SLEW_TAU_S,
  DEFAULT_ADAPTATION_TUNING,
  displayFloorDm,
  eyeAdaptationDm,
  L_ADAPT,
  L_TARGET,
} from './scene-adaptation-pure';
import {
  ADAPT_PARK_PROBE_INTERVAL_FRAMES,
  ADAPT_PARK_SETTLED_LANDINGS,
} from './park/adaptation-park-pure';

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
let measurementReady: boolean;

function makeAdaptation(): SceneAdaptation {
  return new SceneAdaptation({
    baseExposure: () => base,
    reduced: () => reduced,
    measurementReady: () => measurementReady,
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

/** The slew PARKS within the settle band of the branch answer rather than
 *  converging onto it exactly — the parked cut is a fixed point of the
 *  applied value, which is what breaks the fp16 readback limit cycle
 *  (`slewDm` in scene-adaptation-pure.ts). `bands` widens the tolerance
 *  where two independently parked values are compared. */
function expectSettled(dm: number, expected: number, bands = 1) {
  expect(Math.abs(dm - expected)).toBeLessThanOrEqual(bands * ADAPT_SLEW_SETTLE_MAG);
}

beforeEach(() => {
  reduced = null;
  base = BASE_EXPOSURE;
  whitePoint = tonemapWhitePoint();
  measurementReady = true;
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
    expectSettled(settle(adaptation), eyeAdaptationDm(100 * L_ADAPT));
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
    expectSettled(pinned, target());
    expect(pinned).toBeGreaterThan(eyeAdaptationDm(reduced.meanL));
    // The displayed disc lands on L_TARGET to the settle band, in mags.
    expectSettled(2.5 * Math.log10((100 * L_ADAPT * 10 ** (0.4 * pinned)) / L_TARGET), 0);
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
    expectSettled(settle(adaptation), settled);
  });

  it('parks bit-identical against a two-state measurement inside the band', () => {
    // The fp16 limit cycle this contract exists for: the statistic is
    // rendered with the exposure the cut set, and RG16F rounding hands the
    // readback two adjacent values a fraction of the band apart. Tracking
    // them gives that quantiser a unity-gain loop; the applied cut must
    // park and stay bit-identical instead.
    const adaptation = makeAdaptation();
    const meanL = 100 * L_ADAPT / POINT_COVERAGE;
    reduced = frame(meanL, POINT_COVERAGE);
    settle(adaptation);
    const wobble = (i: number) =>
      frame(meanL * 10 ** (((i % 2 === 0 ? 1 : -1) * 7e-4) / 2.5), POINT_COVERAGE);
    // Let the park re-anchor against the alternation first: a cut parked at
    // the band's very edge may take a step or two to land inside BOTH states.
    let parked = 0;
    for (let i = 0; i < 50; i++) {
      reduced = wobble(i);
      parked = adaptation.measure(false, SETTLED_MS + SETTLE_STEP_MS * (i + 1), false);
    }
    for (let i = 50; i < 70; i++) {
      reduced = wobble(i);
      expect(adaptation.measure(false, SETTLED_MS + SETTLE_STEP_MS * (i + 1), false))
        .toBe(parked);
    }
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

  it('holds the cut against a changed measurement, and outranks chart', () => {
    // The frame-cost lever: a toggled pass that writes the statistic
    // attachment would otherwise move the cut, and the differential would
    // price a different star population instead of the pass. Chart's park
    // is one such toggle, so the hold has to beat its reset too.
    const adaptation = makeAdaptation();
    reduced = frame(100 * L_ADAPT / POINT_COVERAGE, POINT_COVERAGE);
    const pinned = settle(adaptation);
    expect(pinned).not.toBe(0);

    adaptation.setHeld(true);
    reduced = frame(1e6 * L_ADAPT / POINT_COVERAGE, POINT_COVERAGE);
    expect(adaptation.measure(false, SETTLED_MS + 16, false)).toBe(pinned);
    expect(adaptation.measure(true, SETTLED_MS + 32, false)).toBe(pinned);
    expect(adaptation.getStatistic().meanL).toBeCloseTo(100 * L_ADAPT, 6);

    // Released, the next frame snaps to the live measurement rather than
    // ramping from a cut that is now stale by the whole hold.
    adaptation.setHeld(false);
    const snapped = adaptation.measure(false, SETTLED_MS + 48, false);
    expect(snapped).toBeCloseTo(adaptation.branches().dm, 9);
    expect(snapped).toBeLessThan(pinned);
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

// The park machine is pure and tested on its own; these pin the class's
// wiring of it — what counts as a fresh landing, and which of the hold,
// chart and warp seams reach it.
describe('SceneAdaptation — the measurement park', () => {
  /** One landed reading of a frame with nothing bright in it — a NEW object
   *  per landing, since freshness is reference identity, exactly as a new
   *  `poll()` landing is in the reduction. */
  function darkLanding(): ReducedStatistic {
    return { meanL: 0.1 * L_ADAPT, surfaceL: 0, coverage: 0, renderExposure: BASE_EXPOSURE };
  }

  let now = 0;
  const step = (adaptation: SceneAdaptation) =>
    adaptation.measure(false, (now += 16), false);

  function parkIt(adaptation: SceneAdaptation): void {
    for (let i = 0; i < ADAPT_PARK_SETTLED_LANDINGS; i++) {
      reduced = darkLanding();
      step(adaptation);
    }
  }

  /** Frames with no fresh landing — `reduced` holds the same object, as the
   *  frozen `latest` does while the reduction's draws are parked. */
  function idle(adaptation: SceneAdaptation, frames: number): void {
    for (let i = 0; i < frames; i++) step(adaptation);
  }

  beforeEach(() => { now = 0; });

  it('parks after the required run of zero landings, and not before', () => {
    const adaptation = makeAdaptation();
    for (let i = 0; i < ADAPT_PARK_SETTLED_LANDINGS; i++) {
      expect(adaptation.isMeasurementParked()).toBe(false);
      reduced = darkLanding();
      step(adaptation);
    }
    expect(adaptation.isMeasurementParked()).toBe(true);
    expect(adaptation.getDm()).toBe(0);
  });

  it('counts landings, not the frames a reading stays current for', () => {
    const adaptation = makeAdaptation();
    reduced = darkLanding();
    idle(adaptation, 10 * ADAPT_PARK_SETTLED_LANDINGS);
    expect(adaptation.isMeasurementParked()).toBe(false);
  });

  it('opens a probe after the interval and re-parks on a zero landing', () => {
    const adaptation = makeAdaptation();
    parkIt(adaptation);
    idle(adaptation, ADAPT_PARK_PROBE_INTERVAL_FRAMES - 1);
    expect(adaptation.getParkPhase()).toBe('parked');
    step(adaptation);
    expect(adaptation.getParkPhase()).toBe('probing');
    expect(adaptation.isMeasurementParked()).toBe(false);
    reduced = darkLanding();
    step(adaptation);
    expect(adaptation.getParkPhase()).toBe('parked');
  });

  it('waits for a frame the reduction can draw before opening the probe', () => {
    const adaptation = makeAdaptation();
    parkIt(adaptation);
    measurementReady = false;
    idle(adaptation, 4 * ADAPT_PARK_PROBE_INTERVAL_FRAMES);
    expect(adaptation.getParkPhase()).toBe('parked');
    measurementReady = true;
    step(adaptation);
    expect(adaptation.getParkPhase()).toBe('probing');
  });

  it('unparks on a bright probe landing and slews from zero', () => {
    const adaptation = makeAdaptation();
    parkIt(adaptation);
    idle(adaptation, ADAPT_PARK_PROBE_INTERVAL_FRAMES);
    reduced = frame(1e4 * L_ADAPT / POINT_COVERAGE, POINT_COVERAGE);
    const first = step(adaptation);
    expect(adaptation.getParkPhase()).toBe('active');
    expect(first).toBeLessThan(0);
    expect(first).toBeGreaterThan(target());
  });

  /** The app default view as the reduction reports it: one saturated kernel
   *  emitter well over the operator's white point, no lit resolved surface.
   *  A new object per call — freshness is reference identity. */
  function floorLanding(): ReducedStatistic {
    return {
      meanL: 3.4 * tonemapWhitePoint(),
      surfaceL: 0,
      coverage: 0,
      renderExposure: BASE_EXPOSURE,
    };
  }

  /** Run the applied cut onto the display floor. The first frame snaps (no
   *  previous wall clock for the slew), so that landing is itself parkable
   *  and banks the first of the streak; the rest of the frames re-read the
   *  same object and land nothing. */
  function settleAtFloor(adaptation: SceneAdaptation): void {
    reduced = floorLanding();
    for (let i = 0; i < 200; i++) adaptation.measure(false, (now += SETTLE_STEP_MS), false);
  }

  function landFloorFrames(adaptation: SceneAdaptation, n: number): void {
    for (let i = 0; i < n; i++) {
      reduced = floorLanding();
      step(adaptation);
    }
  }

  it('parks the floor regime, where the cut is a constant the frame cannot move', () => {
    const adaptation = makeAdaptation();
    settleAtFloor(adaptation);
    expect(adaptation.branches().regime).toBe('floor');
    expectSettled(adaptation.getDm(), ADAPT_DISPLAY_FLOOR_DM);
    expect(adaptation.isMeasurementParked()).toBe(false);

    landFloorFrames(adaptation, ADAPT_PARK_SETTLED_LANDINGS - 2);
    expect(adaptation.isMeasurementParked()).toBe(false);
    landFloorFrames(adaptation, 1);
    expect(adaptation.isMeasurementParked()).toBe(true);
  });

  it('holds the parked floor cut bit-identical — the floor reads no part of the frame', () => {
    const adaptation = makeAdaptation();
    settleAtFloor(adaptation);
    landFloorFrames(adaptation, ADAPT_PARK_SETTLED_LANDINGS - 1);
    const parked = adaptation.getDm();
    idle(adaptation, ADAPT_PARK_PROBE_INTERVAL_FRAMES - 1);
    expect(adaptation.getDm()).toBe(parked);
    // A probe landing that measures the same regime re-parks and leaves the
    // applied cut exactly where it stood: the parked and unparked cut are the
    // same number, not merely close.
    idle(adaptation, 1);
    expect(adaptation.getParkPhase()).toBe('probing');
    reduced = floorLanding();
    step(adaptation);
    expect(adaptation.getParkPhase()).toBe('parked');
    expect(adaptation.getDm()).toBe(parked);
  });

  it('unparks the floor regime once the frame mean drops under the white point', () => {
    const adaptation = makeAdaptation();
    settleAtFloor(adaptation);
    landFloorFrames(adaptation, ADAPT_PARK_SETTLED_LANDINGS - 1);
    expect(adaptation.isMeasurementParked()).toBe(true);
    idle(adaptation, ADAPT_PARK_PROBE_INTERVAL_FRAMES);
    expect(adaptation.getParkPhase()).toBe('probing');
    // Under the white point the eye branch clears the floor and governs, so
    // the cut is the measurement's again.
    reduced = frame(0.5 * tonemapWhitePoint() / POINT_COVERAGE, POINT_COVERAGE);
    step(adaptation);
    expect(adaptation.branches().regime).toBe('eye');
    expect(adaptation.getParkPhase()).toBe('active');
  });

  it('clears the park on chart entry', () => {
    const adaptation = makeAdaptation();
    parkIt(adaptation);
    adaptation.measure(true, (now += 16), false);
    expect(adaptation.getParkPhase()).toBe('active');
  });

  it('freezes under a hold, collapsing a probe in flight to parked', () => {
    const adaptation = makeAdaptation();
    parkIt(adaptation);
    idle(adaptation, ADAPT_PARK_PROBE_INTERVAL_FRAMES);
    expect(adaptation.getParkPhase()).toBe('probing');
    adaptation.setHeld(true);
    expect(adaptation.getParkPhase()).toBe('parked');
    // Held frames never re-open a probe, so every dwell of a sweep prices
    // the same parked frame. The frame this releases into has to be one the
    // measurement genuinely sets the cut for — a mean over the white point
    // would put the release in the floor regime, which parks by design.
    reduced = frame(10 * L_ADAPT / POINT_COVERAGE, POINT_COVERAGE);
    idle(adaptation, 10 * ADAPT_PARK_PROBE_INTERVAL_FRAMES);
    expect(adaptation.getParkPhase()).toBe('parked');
    adaptation.setHeld(false);
    step(adaptation);
    expect(adaptation.getParkPhase()).toBe('active');
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
    expectSettled(settle(swept), shipped + MAG_PER_STOP, 2);
  });

  it('applies a swept L_TARGET to a pin-governed cut', () => {
    reduced = frame(100 * L_ADAPT, 0.9);
    const shipped = settle(makeAdaptation());
    const swept = makeAdaptation();
    swept.setLTarget(2 * L_TARGET);
    expectSettled(settle(swept), shipped + MAG_PER_STOP, 2);
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
    expectSettled(settle(makeAdaptation()), ADAPT_DISPLAY_FLOOR_DM);
    whitePoint = tonemapWhitePoint(11);
    const swept = settle(makeAdaptation());
    expectSettled(swept, displayFloorDm({ ...DEFAULT_ADAPTATION_TUNING, whitePoint }));
    expect(swept - ADAPT_DISPLAY_FLOOR_DM).toBeCloseTo(-3.5, 1);
  });
});

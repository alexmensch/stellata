import { describe, expect, it } from 'vitest';
import { tonemapWhitePoint } from '../tonemap/tonemap-pure';
import {
  type ExposureReadout,
  formatExposureReadout,
  hasMeasurement,
  regimeLine,
} from './exposure-tuning-pure';
import {
  ADAPT_DISPLAY_FLOOR_DM,
  ADAPT_DOT_COVERAGE,
  ADAPT_PIN_COVERAGE,
  ADAPT_SLEW_SETTLE_MAG,
} from './scene-adaptation-pure';

const SETTLED: ExposureReadout = {
  meanL: 7.13e4,
  discL: 3.57e5,
  coverage: 0.2,
  weight: 1,
  eye: -17.52,
  pin: -14.01,
  floor: ADAPT_DISPLAY_FLOOR_DM,
  measuredDm: -14.01,
  appliedDm: -14.01,
  regime: 'surface',
  parkPhase: 'active',
  limitMag: 7.8,
  ev: 0,
  effectiveLimitMag: -5.41,
  exposure: 17.1,
  whitePoint: tonemapWhitePoint(),
  extendedThresholdSb: 22,
  pinCoverage: ADAPT_PIN_COVERAGE,
  dotCoverage: ADAPT_DOT_COVERAGE,
};

describe('hasMeasurement', () => {
  // A cold start and chart's reset both leave a zero statistic, which the
  // branches read as the `open` regime — a true statement about a frame,
  // and a wrong one about a frame nothing has measured yet.
  it('is false only when neither channel carries anything', () => {
    expect(hasMeasurement({ ...SETTLED, meanL: 0, coverage: 0 })).toBe(false);
    expect(hasMeasurement({ ...SETTLED, meanL: 0 })).toBe(true);
    expect(hasMeasurement({ ...SETTLED, coverage: 0 })).toBe(true);
  });

  it('says so rather than naming a branch', () => {
    expect(regimeLine({ ...SETTLED, meanL: 0, coverage: 0 }))
      .toBe('no measurement — no cut');
  });
});

describe('regimeLine', () => {
  it('names each of the five regimes', () => {
    expect(regimeLine(SETTLED)).toBe('SURFACE (resolved pin)');
    expect(regimeLine({ ...SETTLED, regime: 'eye' })).toBe('EYE (perception)');
    expect(regimeLine({ ...SETTLED, regime: 'floor' }))
      .toBe('FLOOR (display bound)');
    expect(regimeLine({ ...SETTLED, regime: 'handover' }))
      .toBe('HANDOVER (ramp)');
    // A frame no term cut says exactly that, instead of handing the credit
    // to whichever branch happened to clamp at zero.
    expect(regimeLine({ ...SETTLED, regime: 'open' })).toBe('OPEN (no term cut)');
  });

  // The slew flag is the panel's answer to "is the frame still ramping?",
  // and it has to use the same settle band the slew itself snaps inside or
  // a settled frame reads as permanently slewing.
  it('flags slewing exactly outside the slew settle band', () => {
    const nudge = (d: number) => ({ ...SETTLED, appliedDm: SETTLED.measuredDm + d });
    expect(regimeLine(nudge(0))).not.toContain('slewing');
    expect(regimeLine(nudge(ADAPT_SLEW_SETTLE_MAG))).not.toContain('slewing');
    expect(regimeLine(nudge(2 * ADAPT_SLEW_SETTLE_MAG))).toContain('slewing');
    expect(regimeLine(nudge(-2 * ADAPT_SLEW_SETTLE_MAG))).toContain('slewing');
  });

  // A parked frame reads "OPEN" off its frozen statistic, which is true and
  // insufficient: without the suffix there is no way to tell a live zero cut
  // from a gated measurement when checking that the park engaged.
  it('names the park phase, on measured and unmeasured frames alike', () => {
    expect(regimeLine(SETTLED)).not.toContain('·');
    expect(regimeLine({ ...SETTLED, parkPhase: 'parked' }))
      .toBe('SURFACE (resolved pin) · PARKED (measurement gated)');
    expect(regimeLine({ ...SETTLED, parkPhase: 'probing' })).toContain('· probing');
    expect(regimeLine({ ...SETTLED, meanL: 0, coverage: 0, parkPhase: 'parked' }))
      .toBe('no measurement — no cut · PARKED (measurement gated)');
  });
});

describe('formatExposureReadout', () => {
  it('carries every term behind the cut', () => {
    const text = formatExposureReadout(SETTLED);
    expect(text).toContain('L̄ 7.13e+4');
    expect(text).toContain('cover 20.00%');
    expect(text).toContain('D 3.57e+5');
    expect(text).toContain('dm_eye -17.52');
    expect(text).toContain('pin -14.01');
    expect(text).toContain('floor -6.29');
    expect(text).toContain('w 1.00');
    expect(text).toContain('measured -14.01');
    expect(text).toContain('applied -14.01');
    expect(text).toContain('SURFACE (resolved pin)');
  });

  it('carries the exposure decomposition and its effective limit', () => {
    const text = formatExposureReadout({ ...SETTLED, ev: -1 });
    expect(text).toContain('m_lim 7.80');
    expect(text).toContain('EV -1.00');
    expect(text).toContain('effective limit  m -5.41');
    expect(text).toContain('uExposure 1.710e+1');
  });

  it('reports both ends of the coverage ramp as percentages', () => {
    const text = formatExposureReadout(SETTLED);
    expect(text).toContain('f_pin 6.85%');
    expect(text).toContain('f_dot 0.86%');
  });

  it('separates the derived levels from the baked constants', () => {
    const text = formatExposureReadout(SETTLED);
    expect(text).toContain('derived: Lw 20.00  S_lim 22.00');
    expect(text).toContain('baked:   L_THRESH 0.02  LUMA_CEIL 4096');
  });

  // Lw is the live uniform, and the DR_MAG slider sits two rows under it —
  // printing it beside the two compile-time GLSL constants would call the
  // one number on the panel that the panel itself moves a baked one.
  it('follows a swept white point', () => {
    const swept = formatExposureReadout({
      ...SETTLED,
      whitePoint: tonemapWhitePoint(11),
    });
    expect(swept).toContain('derived: Lw 502.38');
  });

  it('signs a positive trim so it cannot read as a cut', () => {
    expect(formatExposureReadout({ ...SETTLED, ev: 2 })).toContain('EV +2.00');
  });
});

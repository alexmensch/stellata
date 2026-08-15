import { describe, expect, it } from 'vitest';
import { tonemapWhitePoint } from '../tonemap-pure';
import {
  type ExposureReadout,
  formatExposureReadout,
  hasMeasurement,
  regimeLine,
} from './exposure-tuning-pure';
import {
  ADAPT_DISPLAY_FLOOR_DM,
  ADAPT_REF_COVERAGE,
  ADAPT_SLEW_SETTLE_MAG,
  guardHandoverCoverage,
} from './scene-adaptation-pure';

const SETTLED: ExposureReadout = {
  meanL: 7.13e4,
  peakL: 3.6e5,
  eye: -17.52,
  guard: -13.21,
  floor: ADAPT_DISPLAY_FLOOR_DM,
  measuredDm: -13.21,
  appliedDm: -13.21,
  regime: 'guard',
  limitMag: 7.8,
  ev: 0,
  effectiveLimitMag: -5.41,
  exposure: 17.1,
  whitePoint: tonemapWhitePoint(),
  extendedThresholdSb: 22,
  handoverCoverage: guardHandoverCoverage(),
  refCoverage: ADAPT_REF_COVERAGE,
};

describe('hasMeasurement', () => {
  // adaptationBranches on a zero statistic returns guard >= eye and labels
  // the regime 'guard', which would read as a governing branch on a frame
  // that has measured nothing at all — a cold start or chart's reset.
  it('is false only when neither channel carries light', () => {
    expect(hasMeasurement({ ...SETTLED, meanL: 0, peakL: 0 })).toBe(false);
    expect(hasMeasurement({ ...SETTLED, meanL: 0 })).toBe(true);
    expect(hasMeasurement({ ...SETTLED, peakL: 0 })).toBe(true);
  });

  it('says so rather than naming a branch', () => {
    expect(regimeLine({ ...SETTLED, meanL: 0, peakL: 0 }))
      .toBe('no measurement — no cut');
  });
});

describe('regimeLine', () => {
  it('names each of the four regimes', () => {
    expect(regimeLine(SETTLED)).toBe('GUARD (highlight pin)');
    expect(regimeLine({ ...SETTLED, regime: 'eye' })).toBe('EYE (perception)');
    expect(regimeLine({ ...SETTLED, regime: 'floor' }))
      .toBe('FLOOR (display bound)');
    expect(regimeLine({ ...SETTLED, regime: 'handover' }))
      .toBe('HANDOVER (ramp)');
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
});

describe('formatExposureReadout', () => {
  it('carries every term behind the cut', () => {
    const text = formatExposureReadout(SETTLED);
    expect(text).toContain('L̄ 7.13e+4');
    expect(text).toContain('peak 3.60e+5');
    expect(text).toContain('dm_eye -17.52');
    expect(text).toContain('guard -13.21');
    expect(text).toContain('floor -6.29');
    expect(text).toContain('measured -13.21');
    expect(text).toContain('applied -13.21');
    expect(text).toContain('GUARD (highlight pin)');
  });

  it('carries the exposure decomposition and its effective limit', () => {
    const text = formatExposureReadout({ ...SETTLED, ev: -1 });
    expect(text).toContain('m_lim 7.80');
    expect(text).toContain('EV -1.00');
    expect(text).toContain('effective limit  m -5.41');
    expect(text).toContain('uExposure 1.710e+1');
  });

  // f* is derived from the live L_ADAPT / L_CAP, so it moves with the
  // sliders — the reason it is a readout rather than a printed constant.
  it('reports the handover and reference coverages as percentages', () => {
    const text = formatExposureReadout(SETTLED);
    expect(text).toContain('f* 5.08%');
    expect(text).toContain('f_ref 6.85%');
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

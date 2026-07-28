import { describe, expect, it } from 'vitest';
import {
  BASE_EPOCH_EXPOSURE,
  cullMagFor,
  drawCutoffMag,
  EV_MAX_STOPS,
  EV_STEP_STOPS,
  MAG_PER_STOP,
  exposureForMagLimit,
  sceneExposure,
  thresholdMagFor,
} from './exposure-epoch';
import { luminanceForMagnitude } from '../emission-pure';
import { L_THRESH } from '../tonemap-pure';
import {
  DEFAULT_FILTER,
  instrumentLimitMag,
  limitMagForAperture,
} from '../../filters/filter-state';
import { SOFT_TAPER_MARGIN_MAG } from '../../solar-system/perceptual-magnitude';

const EYE_LIMIT_MAG = instrumentLimitMag(DEFAULT_FILTER.instrument);

describe('limitMagForAperture', () => {
  it('anchors the unaided eye at m 7.8 for a 7 mm dark-adapted pupil', () => {
    expect(limitMagForAperture(7)).toBe(7.8);
    expect(EYE_LIMIT_MAG).toBe(7.8);
  });

  it('buys 1.5 magnitudes per doubling of aperture (area ∝ D²)', () => {
    expect(limitMagForAperture(14) - limitMagForAperture(7)).toBeCloseTo(
      2.5 * Math.log10(4),
      12,
    );
  });

  it('lands 50 mm binoculars 4.3 mag deeper — the retired preset step', () => {
    // docs/science-hdr-pipeline.md § 3.4: (50/7)² = 51× = 4.3 mag, which
    // is what made exposureMul a double-count.
    expect(limitMagForAperture(50) - EYE_LIMIT_MAG).toBeCloseTo(4.2694, 4);
  });
});

describe('exposureForMagLimit', () => {
  it('lands the base epoch on the design gate value', () => {
    expect(BASE_EPOCH_EXPOSURE).toBeCloseTo(26.3651, 4);
  });

  it('puts a source at the limit exactly on L_THRESH', () => {
    for (const mLim of [6.5, 7.8, 10.5, 15]) {
      expect(luminanceForMagnitude(exposureForMagLimit(mLim), mLim)).toBeCloseTo(
        L_THRESH,
        12,
      );
    }
  });

  it('is one magnitude per 10^0.4 of exposure', () => {
    expect(exposureForMagLimit(7.5) / exposureForMagLimit(6.5)).toBeCloseTo(
      10 ** 0.4,
      12,
    );
  });
});

describe('sceneExposure', () => {
  it('is the plain instrument exposure at EV 0 on an unadapted frame', () => {
    expect(sceneExposure(EYE_LIMIT_MAG)).toBe(BASE_EPOCH_EXPOSURE);
    expect(sceneExposure(EYE_LIMIT_MAG, 0, 0)).toBe(BASE_EPOCH_EXPOSURE);
  });

  it('moves the scene by exactly one stop per EV step', () => {
    expect(sceneExposure(EYE_LIMIT_MAG, 0, 1) / BASE_EPOCH_EXPOSURE)
      .toBeCloseTo(2, 12);
    expect(sceneExposure(EYE_LIMIT_MAG, 0, -1) / BASE_EPOCH_EXPOSURE)
      .toBeCloseTo(0.5, 12);
    expect(sceneExposure(EYE_LIMIT_MAG, 0, EV_MAX_STOPS) / BASE_EPOCH_EXPOSURE)
      .toBeCloseTo(8, 12);
  });

  it('is 0.753 mag per stop', () => {
    expect(MAG_PER_STOP).toBeCloseTo(0.7526, 4);
    expect(EV_MAX_STOPS * MAG_PER_STOP).toBeCloseTo(2.2577, 4);
  });

  it('cuts by dm and never lets adaptation brighten (dm ≤ 0 invariant)', () => {
    expect(sceneExposure(EYE_LIMIT_MAG, -2.5) / BASE_EPOCH_EXPOSURE)
      .toBeCloseTo(0.1, 12);
    expect(sceneExposure(EYE_LIMIT_MAG, +5)).toBe(BASE_EPOCH_EXPOSURE);
  });
});

describe('thresholdMagFor', () => {
  it('is the instrument limit at EV 0 — a source there lands on L_THRESH', () => {
    expect(thresholdMagFor(EYE_LIMIT_MAG)).toBe(EYE_LIMIT_MAG);
    const exposure = sceneExposure(EYE_LIMIT_MAG);
    expect(luminanceForMagnitude(exposure, thresholdMagFor(EYE_LIMIT_MAG)))
      .toBeCloseTo(L_THRESH, 12);
  });

  it('keeps that identity at any trim — the taper follows the floor', () => {
    for (const ev of [-EV_MAX_STOPS, -1, EV_STEP_STOPS, EV_MAX_STOPS]) {
      const exposure = sceneExposure(EYE_LIMIT_MAG, 0, ev);
      expect(luminanceForMagnitude(exposure, thresholdMagFor(EYE_LIMIT_MAG, ev)))
        .toBeCloseTo(L_THRESH, 12);
    }
  });

  it('reaches 2.26 mag deeper at +3 stops', () => {
    expect(thresholdMagFor(EYE_LIMIT_MAG, EV_MAX_STOPS)).toBeCloseTo(10.0577, 4);
  });
});

describe('cullMagFor', () => {
  it('covers the deepest the trim can reach, plus the taper', () => {
    expect(cullMagFor(EYE_LIMIT_MAG)).toBeCloseTo(10.5577, 4);
    expect(cullMagFor(EYE_LIMIT_MAG)).toBe(
      thresholdMagFor(EYE_LIMIT_MAG, EV_MAX_STOPS) + SOFT_TAPER_MARGIN_MAG,
    );
  });

  it('is static in the trim, so no EV setting can expose a population edge', () => {
    const bound = cullMagFor(EYE_LIMIT_MAG);
    for (const ev of [-EV_MAX_STOPS, 0, EV_MAX_STOPS]) {
      expect(thresholdMagFor(EYE_LIMIT_MAG, ev) + SOFT_TAPER_MARGIN_MAG)
        .toBeLessThanOrEqual(bound);
    }
  });
});

describe('drawCutoffMag', () => {
  it('fades over the taper in navigate and hard-clips in chart', () => {
    const limit = EYE_LIMIT_MAG;
    const threshold = thresholdMagFor(limit, 1);
    expect(drawCutoffMag(limit, threshold, false))
      .toBe(threshold + SOFT_TAPER_MARGIN_MAG);
    expect(drawCutoffMag(limit, threshold, true)).toBe(limit);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_INSTRUMENT, instrumentLimitMag } from '../../filters/filter-state';
import { SOFT_TAPER_MARGIN_MAG } from '../../solar-system/perceptual-magnitude';
import { ExposureController, type ExposureUniforms } from './exposure-controller';
import {
  cullMagFor,
  EV_MAX_STOPS,
  MAG_PER_STOP,
  sceneExposure,
  summationSolidAngleFor,
} from './exposure-epoch';

function harness() {
  const uniforms: ExposureUniforms = {
    uExposure: { value: -1 },
    uOmegaSummationArcsec2: { value: -1 },
    uLimitMag: { value: -1 },
    uThresholdMag: { value: -1 },
    uCullMag: { value: -1 },
  };
  const onChange = vi.fn();
  const controller = new ExposureController({ uniforms, onChange }, DEFAULT_INSTRUMENT);
  return { uniforms, onChange, controller };
}

const LIMIT = instrumentLimitMag(DEFAULT_INSTRUMENT);

describe('ExposureController', () => {
  it('writes all five slots from its own constructor', () => {
    // The seeds in buildSharedUniforms must never reach a shader, so
    // construction alone has to leave every slot correct.
    const { uniforms } = harness();
    expect(uniforms.uLimitMag.value).toBe(LIMIT);
    expect(uniforms.uThresholdMag.value).toBe(LIMIT);
    expect(uniforms.uCullMag.value).toBe(cullMagFor(LIMIT));
    expect(uniforms.uExposure.value).toBe(sceneExposure(LIMIT));
    expect(uniforms.uOmegaSummationArcsec2.value)
      .toBe(summationSolidAngleFor(DEFAULT_INSTRUMENT));
  });

  // The summation area is the offset between two THRESHOLDS, and both move
  // together under adaptation and the trim — so it is static in the
  // exposure state and only an instrument change may move it.
  it('holds the summation solid angle across every trim', () => {
    const { uniforms, controller } = harness();
    const base = uniforms.uOmegaSummationArcsec2.value;
    for (const ev of [-EV_MAX_STOPS, 1, EV_MAX_STOPS]) {
      controller.setEv(ev);
      expect(uniforms.uOmegaSummationArcsec2.value).toBe(base);
    }
    controller.setAdaptation(-4);
    expect(uniforms.uOmegaSummationArcsec2.value).toBe(base);
  });

  it('moves the scene by exactly one stop per stop of trim', () => {
    const { uniforms, controller } = harness();
    const base = uniforms.uExposure.value;
    controller.setEv(1);
    expect(uniforms.uExposure.value / base).toBeCloseTo(2, 12);
    controller.setEv(-1);
    expect(uniforms.uExposure.value / base).toBeCloseTo(0.5, 12);
  });

  it('follows the trim with the threshold, and never with the cull', () => {
    const { uniforms, controller } = harness();
    controller.setEv(EV_MAX_STOPS);
    expect(uniforms.uThresholdMag.value).toBeCloseTo(
      LIMIT + EV_MAX_STOPS * MAG_PER_STOP, 12,
    );
    expect(uniforms.uLimitMag.value).toBe(LIMIT);
    // The cull sits at the deepest reachable threshold plus the taper, so
    // the faint edge is always the taper — never a population edge.
    expect(uniforms.uCullMag.value).toBeCloseTo(
      uniforms.uThresholdMag.value + SOFT_TAPER_MARGIN_MAG, 12,
    );
    controller.setEv(-EV_MAX_STOPS);
    expect(uniforms.uCullMag.value).toBe(cullMagFor(LIMIT));
  });

  it('clamps the trim to the slider range', () => {
    const { controller } = harness();
    controller.setEv(99);
    expect(controller.getEv()).toBe(EV_MAX_STOPS);
    controller.setEv(-99);
    expect(controller.getEv()).toBe(-EV_MAX_STOPS);
  });

  it('cuts on adaptation, and refuses to open up', () => {
    const { uniforms, controller } = harness();
    const base = uniforms.uExposure.value;
    controller.setAdaptation(-5);
    expect(controller.getAdaptationDm()).toBe(-5);
    expect(uniforms.uExposure.value).toBeCloseTo(base * 10 ** -2, 9);
    // dm ≤ 0 is the invariant: nothing adapts to see fainter than
    // threshold.
    controller.setAdaptation(3);
    expect(controller.getAdaptationDm()).toBe(0);
    expect(uniforms.uExposure.value).toBe(base);
  });

  it('leaves the magnitude bounds alone while adapting', () => {
    // Adaptation moves every frame; a cull or footprint window keyed on it
    // would thrash its cache.
    const { uniforms, controller } = harness();
    controller.setAdaptation(-8);
    expect(uniforms.uLimitMag.value).toBe(LIMIT);
    expect(uniforms.uThresholdMag.value).toBe(LIMIT);
    expect(uniforms.uCullMag.value).toBe(cullMagFor(LIMIT));
  });

  it('reports the effective limit as threshold plus adaptation', () => {
    const { controller } = harness();
    expect(controller.getEffectiveLimitMag()).toBe(LIMIT);
    controller.setEv(1);
    controller.setAdaptation(-6);
    expect(controller.getEffectiveLimitMag()).toBeCloseTo(LIMIT + MAG_PER_STOP - 6, 12);
  });

  it('fires onChange for user intent only, never per frame', () => {
    const { onChange, controller } = harness();
    expect(onChange).not.toHaveBeenCalled();
    controller.setEv(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    // Same value again is not a change.
    controller.setEv(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    // The URL sync and the panel listen to this; adaptation must not wake
    // them 60 times a second.
    controller.setAdaptation(-4);
    controller.setAdaptation(-3);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

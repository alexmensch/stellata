import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ExposureFrameStep, type ExposureFrameStepDeps } from './exposure-frame-step';
import { exposureForMagLimit } from './exposure-epoch';
import { DEFAULT_ADAPTATION_TUNING, type FrameStatistic } from './scene-adaptation-pure';
import { CADENCE_JND_MAG } from '../../render-gate/cadence/clock-cadence-pure';

const LIMIT_MAG = 7.8;

function harness(opts: { chart?: boolean; statistic?: THREE.Texture | null; fence?: boolean } = {}) {
  let dm = -1;
  let parked = false;
  const chart = { on: opts.chart ?? false };
  const statistic: FrameStatistic | null = null;
  const reduction = {
    fenceWhileParked: opts.fence ?? false,
    reset: vi.fn(),
    measure: vi.fn(),
  };
  const emitterUniforms = {
    uExposure: { value: 3 },
    uOmegaSummationArcsec2: { value: 5 },
    uOmegaPxArcsec2: { value: 7 },
    uWhitePoint: { value: 11 },
  };
  const hdr = {
    emitterUniforms,
    statisticTexture: vi.fn(() => (opts.statistic === undefined ? new THREE.Texture() : opts.statistic)),
    setStatisticWritesParked: vi.fn(),
    reduction,
  };
  const adaptation = {
    measure: vi.fn(() => dm),
    isMeasurementParked: vi.fn(() => parked),
    getLandedStatistic: vi.fn(() => statistic),
    getTuning: vi.fn(() => DEFAULT_ADAPTATION_TUNING),
  };
  const exposure = { getLimitMag: () => LIMIT_MAG, setAdaptation: vi.fn() };
  const invalidate = vi.fn();
  const step = new ExposureFrameStep({
    hdr, exposure, adaptation,
    isChart: () => chart.on,
    drawingBufferSizeInto: (out) => out.set(1920, 1080),
    invalidate,
  } as unknown as ExposureFrameStepDeps);
  return {
    step, hdr, reduction, adaptation, exposure, invalidate, chart,
    setDm: (v: number) => { dm = v; },
    setParked: (v: boolean) => { parked = v; },
  };
}

describe('ExposureFrameStep.frameExposure', () => {
  it('is null in chart', () => {
    expect(harness({ chart: true }).step.frameExposure()).toBeNull();
  });

  it('fills every slot from the live uniforms and the adaptation', () => {
    const { step } = harness();
    expect(step.frameExposure()).toEqual({
      exposure: 3,
      baseExposure: exposureForMagLimit(LIMIT_MAG),
      omegaSummationArcsec2: 5,
      omegaPxArcsec2: 7,
      whitePoint: 11,
      statistic: null,
      tuning: DEFAULT_ADAPTATION_TUNING,
    });
  });

  it('rewrites one record in place', () => {
    const { step } = harness();
    expect(step.frameExposure()).toBe(step.frameExposure());
  });
});

describe('ExposureFrameStep.measure', () => {
  it('applies the cut and parks the statistic writes on the same read it returns', () => {
    const h = harness();
    h.setDm(-2.5);
    h.setParked(true);
    expect(h.step.measure(1000, true)).toBe(true);
    expect(h.adaptation.measure).toHaveBeenCalledWith(false, 1000, true);
    expect(h.exposure.setAdaptation).toHaveBeenCalledWith(-2.5);
    expect(h.hdr.setStatisticWritesParked).toHaveBeenCalledWith(true);
  });

  it('passes chart through to the adaptation', () => {
    const h = harness({ chart: true });
    h.step.measure(0, false);
    expect(h.adaptation.measure).toHaveBeenCalledWith(true, 0, false);
  });

  it('wakes the gate on the first cut, then only past a JND from the last wake', () => {
    const h = harness();
    h.setDm(-1);
    h.step.measure(0, false);
    expect(h.invalidate).toHaveBeenCalledTimes(1);
    expect(h.invalidate).toHaveBeenCalledWith('exposure-cut');
    h.setDm(-1 - CADENCE_JND_MAG * 0.6);
    h.step.measure(16, false);
    expect(h.invalidate).toHaveBeenCalledTimes(1);
    h.setDm(-1 - CADENCE_JND_MAG * 1.2);
    h.step.measure(32, false);
    expect(h.invalidate).toHaveBeenCalledTimes(2);
  });

  it('dispose re-seeds the anchor, so the next cut wakes', () => {
    const h = harness();
    h.step.measure(0, false);
    h.step.dispose();
    h.step.measure(16, false);
    expect(h.invalidate).toHaveBeenCalledTimes(2);
  });
});

describe('ExposureFrameStep.reduce', () => {
  it('reduces the statistic at the drawing-buffer size and live exposure', () => {
    const tex = new THREE.Texture();
    const h = harness({ statistic: tex });
    h.step.reduce(true);
    expect(h.reduction.reset).not.toHaveBeenCalled();
    expect(h.reduction.measure).toHaveBeenCalledWith(tex, 1920, 1080, 3, true);
  });

  it('drops the reduction with no statistic attachment', () => {
    const h = harness({ statistic: null });
    h.step.reduce(false);
    expect(h.reduction.reset).toHaveBeenCalledTimes(1);
    expect(h.reduction.measure).not.toHaveBeenCalled();
  });

  it('still fences with no attachment while a lever holds the fence', () => {
    const h = harness({ statistic: null, fence: true });
    h.step.reduce(true);
    expect(h.reduction.reset).toHaveBeenCalledTimes(1);
    expect(h.reduction.measure).toHaveBeenCalledWith(null, 1920, 1080, 3, true);
  });
});

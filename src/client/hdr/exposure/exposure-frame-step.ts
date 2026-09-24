// See README.md § The frame step.

import * as THREE from 'three';
import type { HdrSeam, ReductionSeam } from '../hdr-seam';
import type { HdrEmitterUniforms } from '../hdr-emitter-uniforms';
import type { ExposureController } from './exposure-controller';
import type { SceneAdaptation } from './scene-adaptation';
import { exposureForMagLimit } from './exposure-epoch';
import type { FrameExposure } from './visibility/emitter-visibility-pure';
import {
  DEFAULT_ADAPTATION_TUNING,
  type AdaptationTuning,
  type FrameStatistic,
} from './scene-adaptation-pure';

export interface ExposureFrameStepDeps {
  readonly hdr: Pick<HdrSeam, 'statisticTexture' | 'setStatisticWritesParked'> & {
    readonly emitterUniforms: Pick<
      HdrEmitterUniforms, 'uExposure' | 'uOmegaSummationArcsec2' | 'uOmegaPxArcsec2' | 'uWhitePoint'
    >;
    readonly reduction: Pick<ReductionSeam, 'fenceWhileParked' | 'measure' | 'reset'>;
  };
  readonly exposure: Pick<ExposureController, 'getLimitMag' | 'setAdaptation'>;
  readonly adaptation: Pick<
    SceneAdaptation, 'measure' | 'isMeasurementParked' | 'getLandedStatistic' | 'getTuning'
  >;
  readonly isChart: () => boolean;
  readonly drawingBufferSizeInto: (out: THREE.Vector2) => void;
  readonly noteExposureCut: (dm: number) => void;
}

export class ExposureFrameStep {
  private readonly drawingBufferSize = new THREE.Vector2();
  private readonly record = {
    exposure: 0,
    baseExposure: 0,
    omegaSummationArcsec2: 0,
    omegaPxArcsec2: 0,
    whitePoint: 0,
    statistic: null as FrameStatistic | null,
    tuning: DEFAULT_ADAPTATION_TUNING as AdaptationTuning,
  } satisfies FrameExposure;

  constructor(private readonly deps: ExposureFrameStepDeps) {}

  /** Null in chart, where nothing may skip on it. */
  frameExposure(): FrameExposure | null {
    if (this.deps.isChart()) return null;
    const u = this.deps.hdr.emitterUniforms;
    const e = this.record;
    e.exposure = u.uExposure.value;
    e.baseExposure = exposureForMagLimit(this.deps.exposure.getLimitMag());
    e.omegaSummationArcsec2 = u.uOmegaSummationArcsec2.value;
    e.omegaPxArcsec2 = u.uOmegaPxArcsec2.value;
    e.whitePoint = u.uWhitePoint.value;
    e.statistic = this.deps.adaptation.getLandedStatistic();
    e.tuning = this.deps.adaptation.getTuning();
    return e;
  }

  /** The returned park verdict is `reduce`'s argument on this same frame. */
  measure(nowMs: number, warpActive: boolean): boolean {
    const { adaptation, exposure, hdr } = this.deps;
    const appliedDm = adaptation.measure(this.deps.isChart(), nowMs, warpActive);
    exposure.setAdaptation(appliedDm);
    const parked = adaptation.isMeasurementParked();
    hdr.setStatisticWritesParked(parked);
    this.deps.noteExposureCut(appliedDm);
    return parked;
  }

  /** Chart renders nothing into the statistic, so the reduction is dropped
   *  rather than run over a stale attachment. */
  reduce(parked: boolean): void {
    const { hdr } = this.deps;
    const statistic = hdr.statisticTexture();
    if (statistic === null) {
      hdr.reduction.reset();
      if (!hdr.reduction.fenceWhileParked) return;
    }
    this.deps.drawingBufferSizeInto(this.drawingBufferSize);
    hdr.reduction.measure(
      statistic,
      this.drawingBufferSize.x, this.drawingBufferSize.y,
      hdr.emitterUniforms.uExposure.value,
      parked,
    );
  }
}

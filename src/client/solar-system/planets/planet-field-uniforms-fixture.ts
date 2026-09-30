// Test-only: the uniform block a PlanetBodyField is constructed over.

import * as THREE from 'three';
import type {
  ChartDiscUniforms,
  PerceptualDiscUniforms,
} from '../../star-pipeline/perceptual-disc/perceptual-disc-uniforms';
import { makeHdrEmitterUniforms, type HdrEmitterUniforms } from '../../hdr/hdr-emitter-uniforms';
import { DEFAULT_FILTER, instrumentLimitMag } from '../../filters/filter-state';
import { cullMagFor } from '../../hdr/exposure/exposure-epoch';

export interface PlanetFieldUniformOptions {
  limitMag?: number;
  viewportPx?: readonly [number, number];
  pixelRatio?: number;
  fovYDeg?: number;
}

export function makePlanetFieldUniforms(
  o: PlanetFieldUniformOptions = {},
): PerceptualDiscUniforms & ChartDiscUniforms & HdrEmitterUniforms {
  const limitMag = o.limitMag ?? instrumentLimitMag(DEFAULT_FILTER.instrument);
  const [w, h] = o.viewportPx ?? [800, 600];
  return {
    ...makeHdrEmitterUniforms(),
    uMonochrome: { value: 0 },
    uChartDiscMaxPx: { value: 28 },
    uChartDiscMinPx: { value: 1.5 },
    uChartMagBright: { value: -2 },
    uLimitMag: { value: limitMag },
    uThresholdMag: { value: limitMag },
    uCullMag: { value: cullMagFor(limitMag) },
    uSizeMin: { value: 2 },
    uSizeMax: { value: 24 },
    uSizeSpan: { value: 8 },
    uSizeKnee: { value: 16 },
    uVisibleThreshold: { value: 0.2 },
    uVisibleK: { value: -Math.log(0.2) },
    uCoreThreshold: { value: 0.4 },
    uDiscardThreshold: { value: 0.02 },
    uDistNMin: { value: 2.2 },
    uDistNMax: { value: 10.0 },
    uLumBiasMin: { value: 1.0 },
    uLumBiasMax: { value: 0.6 },
    uViewport: { value: new THREE.Vector2(w, h) },
    uPixelRatio: { value: o.pixelRatio ?? 1 },
    uFovYRad: { value: ((o.fovYDeg ?? 60) * Math.PI) / 180 },
  };
}

// The uniform slots every physical emitter binds by reference, so one
// write reaches all of them. See README.md § Unit.

import type * as THREE from 'three';
import { angularToPx } from '../camera/controls/star-geometry';
import { DEFAULT_FOV } from '../filters/filter-state';
import { HIGHLIGHT_DESAT, tonemapWhitePoint } from './tonemap/tonemap-pure';
import { pixelSolidAngleArcsec2 } from './emission/emission-pure';
import { BASE_EPOCH_EXPOSURE, DEFAULT_SUMMATION_ARCSEC2 } from './exposure/exposure-epoch';

/** `uHdrTarget` is the branch: 0 means the fragment lands straight on the
 *  canvas and the emitter applies the operator itself. `uExposure` is the
 *  one exposure control, written by `FilterController` from the magnitude
 *  limit. The resolve pass shares the same white-point and desaturation
 *  objects, so the inline path and the fullscreen path cannot disagree. */
export interface HdrEmitterUniforms {
  uHdrTarget: THREE.IUniform<number>;
  uWhitePoint: THREE.IUniform<number>;
  uHighlightDesat: THREE.IUniform<number>;
  uExposure: THREE.IUniform<number>;
  uOmegaPxArcsec2: THREE.IUniform<number>;
  uOmegaSummationArcsec2: THREE.IUniform<number>;
}

export const HDR_EMITTER_UNIFORM_KEYS = [
  'uHdrTarget',
  'uWhitePoint',
  'uHighlightDesat',
  'uExposure',
  'uOmegaPxArcsec2',
  'uOmegaSummationArcsec2',
] as const satisfies readonly (keyof HdrEmitterUniforms)[];

/** Pick the seam's slots out of a wider shared-uniforms object, keeping
 *  each `{ value }` slot's identity — an emitter that copied the values
 *  would tone-map inline into an already-tone-mapped target the moment the
 *  pipeline rewrote `uHdrTarget`. Mirrors `pickPerceptualDiscUniforms`;
 *  used by the planet layers, which read the shared map rather than
 *  holding the pipeline. */
export function pickHdrEmitterUniforms<T extends HdrEmitterUniforms>(
  src: T,
): HdrEmitterUniforms {
  const out: Record<string, THREE.IUniform> = {};
  for (const key of HDR_EMITTER_UNIFORM_KEYS) {
    out[key] = src[key];
  }
  return out as unknown as HdrEmitterUniforms;
}

/** `uHdrTarget` seeds to 0 and the pipeline's constructor rewrites it
 *  before the first frame, as it does `uWhitePoint` and `uHighlightDesat`
 *  (both live dev knobs, rewritten by `syncMode`). `uExposure` seeds at
 *  the base epoch; `ExposureController` owns every later write
 *  (`exposure/README.md`), and `uOmegaSummationArcsec2` the same way.
 *  `uOmegaPxArcsec2` seeds at the default FOV over a 1000 px viewport and
 *  is rewritten by `setPixelSolidAngle` on every FOV / resize change. */
export function makeHdrEmitterUniforms(): HdrEmitterUniforms {
  return {
    uHdrTarget: { value: 0 },
    uWhitePoint: { value: tonemapWhitePoint() },
    uHighlightDesat: { value: HIGHLIGHT_DESAT },
    uExposure: { value: BASE_EPOCH_EXPOSURE },
    uOmegaPxArcsec2: {
      value: pixelSolidAngleArcsec2(angularToPx(1000, (DEFAULT_FOV * Math.PI) / 180)),
    },
    uOmegaSummationArcsec2: { value: DEFAULT_SUMMATION_ARCSEC2 },
  };
}

export const HDR_ATTACHMENT_COUNT = 3;

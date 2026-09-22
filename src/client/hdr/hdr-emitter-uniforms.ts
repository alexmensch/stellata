// The uniform slots every physical emitter binds by reference, so one
// write reaches all of them, and the attachment contract their target
// carries. See README.md §§ Unit, Three attachments.

import * as THREE from 'three';
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

/** Exhaustive both ways: `Record<keyof HdrEmitterUniforms, true>` refuses
 *  a key that is not a slot AND a slot that is not a key. A one-directional
 *  list would let a new slot compile while `pickHdrEmitterUniforms` dropped
 *  it, and the emitter would read `undefined` for that uniform. */
const HDR_EMITTER_UNIFORM_SET: Record<keyof HdrEmitterUniforms, true> = {
  uHdrTarget: true,
  uWhitePoint: true,
  uHighlightDesat: true,
  uExposure: true,
  uOmegaPxArcsec2: true,
  uOmegaSummationArcsec2: true,
};

export const HDR_EMITTER_UNIFORM_KEYS = Object.keys(
  HDR_EMITTER_UNIFORM_SET,
) as (keyof HdrEmitterUniforms)[];

/** Pick the seam's slots out of a wider shared-uniforms object, keeping
 *  each `{ value }` slot's identity — an emitter that copied the values
 *  would tone-map inline into an already-tone-mapped target the moment the
 *  pipeline rewrote `uHdrTarget`. Mirrors `pickPerceptualDiscUniforms`;
 *  used by the planet layers, which read the shared map rather than
 *  holding the pipeline. */
export function pickHdrEmitterUniforms<T extends HdrEmitterUniforms>(
  src: T,
): HdrEmitterUniforms {
  return {
    uHdrTarget: src.uHdrTarget,
    uWhitePoint: src.uWhitePoint,
    uHighlightDesat: src.uHighlightDesat,
    uExposure: src.uExposure,
    uOmegaPxArcsec2: src.uOmegaPxArcsec2,
    uOmegaSummationArcsec2: src.uOmegaSummationArcsec2,
  };
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

/** Per-attachment format and filter state the seam's target carries
 *  (README.md § Three attachments). Takes fewer than
 *  `HDR_ATTACHMENT_COUNT` textures: the extra-attachments frame-cost lever
 *  rebuilds the target with attachment 0 alone. */
export function applyHdrAttachmentState(textures: readonly THREE.Texture[]): void {
  textures[0].colorSpace = THREE.LinearSRGBColorSpace;
  if (textures.length > 1) {
    // Half attachment 0's memory, and the reduction reads its missing
    // alpha as 1 — which is exactly the level-0 weight
    // (exposure/reduction/README.md § The chain).
    textures[1].format = THREE.RGFormat;
    textures[1].colorSpace = THREE.LinearSRGBColorSpace;
  }
  if (textures.length > 2) {
    // Linear to match the downsample target, though inert at factor 1: the
    // resolve reads this attachment directly there, at integer offsets from
    // the fragment position, so every tap lands on a texel centre where
    // bilinear and nearest agree. It stops being inert the moment a tap is
    // off-centre.
    textures[2].minFilter = THREE.LinearFilter;
    textures[2].magFilter = THREE.LinearFilter;
    textures[2].colorSpace = THREE.LinearSRGBColorSpace;
  }
}

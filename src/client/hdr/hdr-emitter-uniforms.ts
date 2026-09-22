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
 *  canvas and the emitter applies the operator itself (README.md § The
 *  inline operator). */
export interface HdrEmitterUniforms {
  uHdrTarget: THREE.IUniform<number>;
  uWhitePoint: THREE.IUniform<number>;
  uHighlightDesat: THREE.IUniform<number>;
  uExposure: THREE.IUniform<number>;
  uOmegaPxArcsec2: THREE.IUniform<number>;
  uOmegaSummationArcsec2: THREE.IUniform<number>;
}

/** Keeps each `{ value }` slot's identity — an emitter that copied the
 *  values would tone-map inline into an already-tone-mapped target the
 *  moment the pipeline rewrote `uHdrTarget`. */
export function pickHdrEmitterUniforms(src: HdrEmitterUniforms): HdrEmitterUniforms {
  return {
    uHdrTarget: src.uHdrTarget,
    uWhitePoint: src.uWhitePoint,
    uHighlightDesat: src.uHighlightDesat,
    uExposure: src.uExposure,
    uOmegaPxArcsec2: src.uOmegaPxArcsec2,
    uOmegaSummationArcsec2: src.uOmegaSummationArcsec2,
  };
}

/** Seeds only: the pipeline's constructor rewrites the operator slots
 *  before the first frame, and the writers of the rest are README.md
 *  §§ Unit, Exposure. */
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

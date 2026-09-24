// The shell surface's seven slots as TSL nodes, seeded from
// ../../fresnel-shell/fresnel-shell.ts's options.

import { Color } from 'three';
import { uniform } from 'three/tsl';
import type { FresnelShellMaterialOptions } from '../../fresnel-shell/fresnel-shell';
import {
  DEFAULT_FACE_ON_FLOOR, DEFAULT_FRESNEL_POWER,
} from '../../fresnel-shell/fresnel-shell';
import {
  DEPTH_DIM_POWER, rimDistancesForExtent,
} from '../../fresnel-shell/shell-distance-pure';
import { setRawChromeColour } from '../../hdr/chrome/chrome-colour';

/** README.md#chrome-so-both-extra-attachments-write-zero. */
export function fresnelShellUniformNodes(opts: FresnelShellMaterialOptions) {
  const reach = rimDistancesForExtent(opts.extentPc);
  return {
    uColour: uniform(setRawChromeColour(new Color(), opts.colourHex)),
    uAlphaLimb: uniform(opts.alphaLimb),
    uFaceOnFloor: uniform(opts.faceOnFloor ?? DEFAULT_FACE_ON_FLOOR),
    uFresnelPower: uniform(opts.fresnelPower ?? DEFAULT_FRESNEL_POWER),
    uNearFadePc: uniform(reach.nearFadePc),
    uDepthDimRefPc: uniform(reach.depthDimRefPc),
    uDepthPower: uniform(DEPTH_DIM_POWER),
  };
}

export type FresnelShellNodes = ReturnType<typeof fresnelShellUniformNodes>;

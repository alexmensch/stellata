// TSL uniform-node twins of createFresnelShellMaterial's uniform block
// (../../fresnel-shell/fresnel-shell.ts) — transcribed key-for-key, pinned
// by a key-parity test.

import { Color } from 'three';
import { uniform } from 'three/tsl';
import type { FresnelShellMaterialOptions } from '../../fresnel-shell/fresnel-shell';
import {
  DEFAULT_FACE_ON_FLOOR, DEFAULT_FRESNEL_POWER,
} from '../../fresnel-shell/fresnel-shell';
import { setRawChromeColour } from '../../hdr/chrome/chrome-colour';

/** `uColour` goes through the same raw-chrome mapping the GLSL factory
 *  uses: the registry is keyed by the live `Color`, so a node's `.value`
 *  re-authors on `syncMode` exactly as a `ShaderMaterial` uniform's does
 *  (`../../hdr/chrome/README.md`). */
export function fresnelShellUniformNodes(opts: FresnelShellMaterialOptions) {
  return {
    uColour: uniform(setRawChromeColour(new Color(), opts.colourHex)),
    uAlphaLimb: uniform(opts.alphaLimb),
    uFaceOnFloor: uniform(opts.faceOnFloor ?? DEFAULT_FACE_ON_FLOOR),
    uFresnelPower: uniform(opts.fresnelPower ?? DEFAULT_FRESNEL_POWER),
  };
}

export type FresnelShellNodes = ReturnType<typeof fresnelShellUniformNodes>;

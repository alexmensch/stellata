// Authored chrome colours pre-mapped through the tone-map's inverse so
// the resolve pass returns them unchanged. See README.md § Chrome.

import * as THREE from 'three';
import {
  inverseTonemapConstant,
  srgbDecode,
  tonemapWhitePoint,
  type Rgb,
} from './tonemap-pure';

const WHITE_POINT = tonemapWhitePoint();

function srgbFromHex(hex: number): Rgb {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

function decode(rgb: Rgb): Rgb {
  return [srgbDecode(rgb[0]), srgbDecode(rgb[1]), srgbDecode(rgb[2])];
}

function assign(target: THREE.Color, linearDisplay: Rgb): THREE.Color {
  const [r, g, b] = inverseTonemapConstant(linearDisplay, WHITE_POINT);
  return target.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
}

/** For three's built-in materials (`LineBasicMaterial`, `LineMaterial`,
 *  `MeshBasicMaterial`): their `colorspace_fragment` encode is what put
 *  the authored hex on screen, and a linear target switches it off.
 *  `chart` skips the mapping — chart mode bypasses the resolve pass. */
export function setBuiltinChromeColour(
  target: THREE.Color,
  hex: number,
  chart = false,
): THREE.Color {
  return chart ? target.setHex(hex) : assign(target, decode(srgbFromHex(hex)));
}

/** For custom shaders that write a colour uniform straight out.
 *  `new THREE.Color(hex)` linearises on construction and the shader then
 *  emitted that number as a display value, so what those layers show is
 *  the hex decoded twice — the appearance this preserves. */
export function setRawChromeColour(
  target: THREE.Color,
  hex: number,
  chart = false,
): THREE.Color {
  return chart ? target.setHex(hex) : assign(target, decode(decode(srgbFromHex(hex))));
}

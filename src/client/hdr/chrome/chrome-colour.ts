// Authored chrome colours pre-mapped through the tone-map's inverse so
// the resolve pass returns them unchanged. See README.md § Chrome.

import * as THREE from 'three';
import {
  inverseTonemapConstant,
  srgbDecode,
  tonemapWhitePoint,
  type Rgb,
} from '../tonemap-pure';

const WHITE_POINT = tonemapWhitePoint();

type ChromeVariant = 'builtin' | 'raw';

interface ChromeBinding {
  hex: number;
  variant: ChromeVariant;
  chart: boolean;
}

/** Every chrome colour written through this module, so the mapping can be
 *  re-derived when the resolve stops applying the operator. Keyed by the
 *  live `Color` instance; re-attachable layers (clouds, Local Group) add
 *  an entry per attach, which `HdrPipeline.dispose` clears. */
const bindings = new Map<THREE.Color, ChromeBinding>();

let operatorActive = true;

function srgbFromHex(hex: number): Rgb {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

function decode(rgb: Rgb): Rgb {
  return [srgbDecode(rgb[0]), srgbDecode(rgb[1]), srgbDecode(rgb[2])];
}

function apply(target: THREE.Color, binding: ChromeBinding): THREE.Color {
  if (binding.chart || !operatorActive) return target.setHex(binding.hex);
  const authored = srgbFromHex(binding.hex);
  const linearDisplay =
    binding.variant === 'raw' ? decode(decode(authored)) : decode(authored);
  const [r, g, b] = inverseTonemapConstant(linearDisplay, WHITE_POINT);
  return target.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
}

function bind(
  target: THREE.Color,
  hex: number,
  variant: ChromeVariant,
  chart: boolean,
): THREE.Color {
  const binding: ChromeBinding = { hex, variant, chart };
  bindings.set(target, binding);
  return apply(target, binding);
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
  return bind(target, hex, 'builtin', chart);
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
  return bind(target, hex, 'raw', chart);
}

/** Re-author every registered chrome colour for whether the resolve pass
 *  is applying the operator. The mapping only makes sense paired with the
 *  operator it inverts: left in place without it, chrome renders wrong —
 *  a dim rim shell drops to a tenth of its authored brightness. Called by
 *  `HdrPipeline` from both the float-support check and the dev switches. */
export function setChromeOperatorActive(on: boolean): void {
  if (operatorActive === on) return;
  operatorActive = on;
  for (const [target, binding] of bindings) apply(target, binding);
}

/** Test seam — the module-level registry otherwise leaks state between
 *  cases. Paired with `HdrPipeline.dispose`. */
export function clearChromeBindings(): void {
  bindings.clear();
  operatorActive = true;
}

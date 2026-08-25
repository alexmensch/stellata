// The renderer-neutral contract the chrome line overlays take their
// materials from. See README.md.

import type * as THREE from 'three';

/**
 * The writable surface a chrome line consumer touches. three's own
 * `LineBasicMaterial` and its node twin both satisfy it, so a layer keeps
 * writing `.color` / `.opacity` / `.depthTest` on either backend.
 */
export interface ChromeLineStroke extends THREE.Material {
  color: THREE.Color;
  opacity: number;
}

/** `scale` maps world distance into the unit `dashSize` / `gapSize` are
 *  authored in, so a pattern can be spelled in screen pixels and driven
 *  from the live FOV. The `lineDistance` attribute is the consumer's own —
 *  `../util/orbit-line.ts` says why `computeLineDistances` will not do. */
export interface DashedChromeLineStroke extends ChromeLineStroke {
  dashSize: number;
  gapSize: number;
  scale: number;
}

export interface ChromeLineMaterial<
  M extends ChromeLineStroke = ChromeLineStroke,
> {
  readonly material: M;
  /** Frees the material and, on WebGPU, its MRT-mode registration. */
  dispose(): void;
}

/**
 * `colour` is an authored sRGB hex, mapped through the tone-map inverse at
 * construction so the stroke resolves at that appearance out of the HDR
 * pass (`../hdr/chrome/README.md`). A consumer that re-authors it later
 * writes `material.color` through the same setter.
 */
export interface ChromeLineMaterials {
  solid(colour: number, opacity: number, localPass?: boolean): ChromeLineMaterial;
  dashed(
    colour: number, dash: number, gap: number, opacity: number,
  ): ChromeLineMaterial<DashedChromeLineStroke>;
}

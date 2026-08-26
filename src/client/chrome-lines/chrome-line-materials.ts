// The renderer-neutral contract the chrome line overlays take their
// materials from. See README.md.

import type * as THREE from 'three';

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

export interface FatChromeLineStroke extends ChromeLineStroke {
  linewidth: number;
}

export interface ChromeLineMaterial<
  M extends ChromeLineStroke = ChromeLineStroke,
> {
  readonly material: M;
  /** Run the stroke opaque with blending off, or alpha-composited.
   *  A layer must not write `material.transparent` itself: the fat
   *  stroke's WebGPU material answers that flag with a full-frame texture
   *  read (`../webgpu/chrome-lines/README.md`). */
  setOpaque(on: boolean): void;
  /** Frees the material and, on WebGPU, its MRT-mode registration. */
  dispose(): void;
}

/** A fat stroke carries its object too. The mesh class is backend-specific
 *  — `three/addons/lines/Line2.js` and `.../lines/webgpu/Line2.js` each
 *  refuse the other's material — so the seam owns the primitive here where
 *  `../util/orbit-line.ts` owns the thin ones. Its geometry stays with the
 *  layer's own child sweep, exactly as a thin line's does. */
export interface ChromeFatLine extends ChromeLineMaterial<FatChromeLineStroke> {
  readonly object: THREE.Object3D;
}

/** `points` is a flat xyz list drawn as an OPEN polyline, so a closed loop
 *  repeats its first vertex; `widthPx` is screen-space. */
export interface FatChromeLineSpec {
  colour: number;
  opacity: number;
  widthPx: number;
  points: Float32Array;
  renderOrder: number;
}

/** `colour` is an authored sRGB hex, not a linear value — README.md
 *  § Colour is authored once, at construction. */
export interface ChromeLineMaterials {
  solid(colour: number, opacity: number, localPass?: boolean): ChromeLineMaterial;
  dashed(
    colour: number, dash: number, gap: number, opacity: number,
  ): ChromeLineMaterial<DashedChromeLineStroke>;
  fat(spec: FatChromeLineSpec): ChromeFatLine;
}

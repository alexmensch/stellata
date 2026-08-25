// Authored ink values of the paper-chart palette, shared by the layers that
// swap into it. See README.md § Chart palette.

import * as THREE from 'three';

/** Ink for chart-mode reference geometry — the galactic coordinate sphere
 *  and the IAU constellation boundaries. Deliberately lighter than the
 *  near-black figure / label ink so reference lines read as a separate
 *  layer under the chart's content. */
export const CHART_REFERENCE_INK = 0x3a3530;

/** The paper itself — the canvas clear colour under chart mode. `--bg` in
 *  styles.css carries the same value for the surrounding UI; CSS cannot
 *  import, so both move together. */
export const CHART_PAPER = 0xf5f2ea;

/** Read the authored paper in the space the renderer clears in, so the
 *  canvas receives the display value on either backend. See README.md
 *  § Chart palette — the clear bypasses every shader, so nothing else
 *  encodes it. `string` because that is how three types a renderer's
 *  `outputColorSpace`; anything but the working space clears as sRGB. */
export function paperClearColour(clearSpace: string): THREE.Color {
  return new THREE.Color().setHex(
    CHART_PAPER,
    clearSpace === THREE.LinearSRGBColorSpace
      ? THREE.LinearSRGBColorSpace
      : THREE.SRGBColorSpace,
  );
}

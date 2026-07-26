// Place-or-hide for an SVG label anchored to a renderer-local position.

import type * as THREE from 'three';
import { projectToScreenInto } from './overlay-project';

const scratchXy: [number, number] = [0, 0];

/** The subset of `SVGElement` the placement writes. Structural rather than
 *  the DOM type so the placement is pinnable under vitest's node
 *  environment, which has no `document` (see stellata's manual-smoke rule). */
export interface LabelSurface {
  readonly style: { display: string };
  setAttribute(name: string, value: string): void;
}

/**
 * Position `el` at its anchor's projected screen point, offset by `offsetPx`
 * on both axes, or hide it when the anchor has no meaningful projection —
 * `projectToScreenInto` rejects at-or-behind-near-plane points, where the
 * perspective divide would smear the label across the viewport edge.
 *
 * Returns whether the label was shown, so a caller with further gates can
 * chain on it. The offset is a parameter rather than a constant here because
 * each label family owns its own gap from its referent.
 */
export function placeAnchoredLabel(
  el: LabelSurface,
  localPos: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  viewportW: number,
  viewportH: number,
  offsetPx: number,
): boolean {
  if (!projectToScreenInto(localPos, camera, viewportW, viewportH, scratchXy)) {
    el.style.display = 'none';
    return false;
  }
  el.style.display = '';
  el.setAttribute('x', (scratchXy[0] + offsetPx).toFixed(1));
  el.setAttribute('y', (scratchXy[1] + offsetPx).toFixed(1));
  return true;
}

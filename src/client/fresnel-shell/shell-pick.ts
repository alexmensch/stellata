// Shared mesh-raycast + label-bbox hit test for boundary shells
// (heliopause, Local Bubble). See ./README.md#boundary-shells-as-focus-targets.

import * as THREE from 'three';
import { enclosureRadiusPx } from '../camera/controls/star-geometry';
import type { HoverHit } from '../hover/hover-types';
import type { ShellPickSurface } from './shell-registry';

export interface ShellPickParams {
  camera: THREE.PerspectiveCamera;
  rect: DOMRect;
  clientX: number;
  clientY: number;
  surface: ShellPickSurface;
  /** To the shell's centre, not the hit surface. */
  cameraDistancePc: number;
  /** Shell Target idx (SHELL_KEYS index). */
  idx: number;
  /** Projected silhouette diameter, the hit's size in the cross-layer
   *  ordering (`../hover/hover-types.ts`). */
  renderedSizePx: number;
  /** The engine's grab radius, flooring the reported enclosure exactly as
   *  it does for every other kind. */
  pixelThreshold: number;
}

// Neither dead centre nor the rim: a raycast cannot say how deep inside
// the silhouette the cursor sits, and this score breaks ties against
// kinds that measure their depth honestly. README.md#shell-pickts.ts.
const SILHOUETTE_DEPTH_SCORE = 0.5;

// Pick-path scratch, rewritten on every call before it is read.
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const anchor = new THREE.Vector3();

/**
 * The drawn mesh under the cursor, OR the label rect. What each half
 * reports for size, depth and anchor: README.md#shell-pickts.ts.
 *
 * The floating-origin offset arrives through the mesh's `matrixWorld`
 * rather than a live `worldOffset` read, so the pick answers against the
 * frame the user actually clicked on rather than the one about to render.
 */
export function pickShellSilhouette(p: ShellPickParams): HoverHit | null {
  const { camera, rect, clientX, clientY, surface } = p;

  let insideSilhouette = false;
  const mesh = surface.mesh();
  if (mesh !== null) {
    ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    raycaster.setFromCamera(ndc, camera);
    const wallHits = raycaster.intersectObject(mesh, false);
    insideSilhouette = wallHits.length > 0;
    if (insideSilhouette) anchor.copy(wallHits[0].point);
  }
  // Must be unconditional: reading the scratch unwritten answers the
  // occlusion gate about whatever the previous call hit. Why the camera
  // is the right anchor here: README.md#shell-pickts.ts.
  if (!insideSilhouette) anchor.copy(camera.position);

  let labelRadiusPx = Infinity;
  let labelDepth = 0;
  const labelEl = document.getElementById(surface.labelElementId);
  if (labelEl) {
    const lr = labelEl.getBoundingClientRect();
    if (lr.width > 0 && lr.height > 0
      && clientX >= lr.left && clientX <= lr.right
      && clientY >= lr.top && clientY <= lr.bottom) {
      labelRadiusPx = Math.max(lr.width, lr.height) * 0.5;
      labelDepth = Math.hypot(
        clientX - (lr.left + lr.right) * 0.5,
        clientY - (lr.top + lr.bottom) * 0.5,
      ) / labelRadiusPx;
    }
  }

  const silhouetteRadiusPx = insideSilhouette ? p.renderedSizePx * 0.5 : Infinity;
  const labelIsTighter = labelRadiusPx <= silhouetteRadiusPx;
  const tightest = labelIsTighter ? labelRadiusPx : silhouetteRadiusPx;
  if (!Number.isFinite(tightest)) return null;
  return {
    idx: p.idx,
    cameraDistancePc: p.cameraDistancePc,
    enclosureRadiusPx: enclosureRadiusPx(tightest, p.pixelThreshold),
    anchorLocal: anchor.clone(),
    depthScore: labelIsTighter ? labelDepth : SILHOUETTE_DEPTH_SCORE,
  };
}

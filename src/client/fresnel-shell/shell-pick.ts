// Shared mesh-raycast + label-bbox hit test for boundary shells
// (heliopause, Local Bubble). See ./README.md § Boundary shells as focus
// targets.

import * as THREE from 'three';
import type { HoverHit } from '../hover/hover-types';
import type { ShellPickSurface } from './shell-registry';

export interface ShellPickParams {
  camera: THREE.PerspectiveCamera;
  rect: DOMRect;
  clientX: number;
  clientY: number;
  surface: ShellPickSurface;
  /** Camera→center distance for the returned hit. */
  cameraDistancePc: number;
  /** Shell Target idx (SHELL_KEYS index). */
  idx: number;
}

// Pick-path scratch — valid only inside one `pickShellSilhouette` call.
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

/**
 * Extended-tier hit: the drawn mesh under the cursor, OR the label rect.
 *
 * The raycast is the mechanism the cloud layer already uses, and two
 * properties fall out of it rather than being coded:
 *
 * - The hit surface is the drawn silhouette exactly. The projected
 *   sample-point bounding box this replaces called the corners of the box
 *   a hit, which for a rounded shell is large regions of empty sky.
 * - A ray from inside the shell misses. The material is `FrontSide`
 *   (README.md § Invariants), so `Mesh.raycast` culls the far wall's back
 *   faces and nothing is left to hit — the hide-when-inside contract
 *   holding itself up, where the bbox path needed an explicit
 *   near-plane bail.
 *
 * The floating-origin offset arrives through the mesh's `matrixWorld`
 * rather than a live `worldOffset` read, so the pick answers against the
 * frame the user actually clicked on rather than the one about to render.
 *
 * The label rect is `display:none` when hidden, so its zero bounds
 * harmlessly fail and the label half needs no visibility plumbing.
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
    insideSilhouette = raycaster.intersectObject(mesh, false).length > 0;
  }

  let insideLabel = false;
  const labelEl = document.getElementById(surface.labelElementId);
  if (labelEl) {
    const lr = labelEl.getBoundingClientRect();
    if (lr.width > 0 && lr.height > 0) {
      insideLabel =
        clientX >= lr.left && clientX <= lr.right && clientY >= lr.top && clientY <= lr.bottom;
    }
  }

  if (!insideSilhouette && !insideLabel) return null;
  return { idx: p.idx, cameraDistancePc: p.cameraDistancePc, tier: 'extended' };
}

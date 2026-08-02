// Shared silhouette-bbox + label-bbox hit test for boundary shells
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
  worldOffset: Readonly<THREE.Vector3>;
  surface: ShellPickSurface;
  /** Camera→center distance for the returned hit. */
  cameraDistancePc: number;
  /** Shell Target idx (SHELL_KEYS index). */
  idx: number;
  scratch: THREE.Vector3;
}

/** Fallback-tier hit: the projected silhouette bbox OR the label rect.
 *  Any sample behind the near plane bails the silhouette (the shell is
 *  hidden-when-inside, matching the label engine), leaving the label rect
 *  — which is `display:none` when hidden, so its zero bounds harmlessly
 *  fail. Mirrors the original inline heliopause pick. */
export function pickShellSilhouette(p: ShellPickParams): HoverHit | null {
  const { camera, rect, clientX, clientY, surface, scratch } = p;
  const cursorX = clientX - rect.left;
  const cursorY = clientY - rect.top;

  let allInFront = true;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const nearNeg = -camera.near;
  const n = surface.sampleCount();
  for (let i = 0; i < n; i++) {
    surface.sampleLocalInto(i, p.worldOffset, scratch);
    scratch.applyMatrix4(camera.matrixWorldInverse);
    if (scratch.z >= nearNeg) {
      allInFront = false;
      break;
    }
    scratch.applyMatrix4(camera.projectionMatrix);
    const sx = (scratch.x + 1) * 0.5 * rect.width;
    const sy = (1 - scratch.y) * 0.5 * rect.height;
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }
  const insideSilhouette =
    allInFront && cursorX >= minX && cursorX <= maxX && cursorY >= minY && cursorY <= maxY;

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
  return { idx: p.idx, cameraDistancePc: p.cameraDistancePc, tier: 'fallback' };
}

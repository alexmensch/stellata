// Shared mesh-raycast + label-bbox hit test for boundary shells
// (heliopause, Local Bubble). See ./README.md § Boundary shells as focus
// targets.

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
  /** Camera→center distance for the returned hit. */
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

// A raycast is hit-or-miss, with no notion of how deep inside the
// silhouette the cursor sits. A shell therefore reports the middle of the
// scale rather than 0: the score breaks ties against every other kind, so
// claiming dead centre would win every one of them against a kind that
// measured its own depth honestly, and claiming the rim would lose them all.
const SILHOUETTE_DEPTH_SCORE = 0.5;

// Pick-path scratch, rewritten on every call before it is read.
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const anchor = new THREE.Vector3();

/**
 * The drawn mesh under the cursor, OR the label rect.
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
    const wallHits = raycaster.intersectObject(mesh, false);
    insideSilhouette = wallHits.length > 0;
    // The wall point the cursor found, never the shell's centre, which is
    // nowhere near it.
    if (insideSilhouette) anchor.copy(wallHits[0].point);
  }
  // A label-only hit anchors at the camera, where no body can hide it
  // (`../occlusion/occlusion-pure.ts` answers a zero-distance anchor "not
  // hidden"). The label engine already asked the occluder set about its
  // own support point before drawing the text, and hides the element when
  // the answer is yes (`../overlays/distance-gated-label.ts`), so a rect
  // with bounds is a label that already passed. Anchoring on the wall
  // behind the text instead would re-ask a different question — and
  // leaving the raycast's anchor untouched would answer about whatever
  // the previous call hit.
  if (!insideSilhouette) anchor.copy(camera.position);

  // A label hit is its own surface, and a much tighter one than the shell
  // it names — reporting the shell's size for it would let anything the
  // label overlaps outrank a cursor sitting straight on the text.
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

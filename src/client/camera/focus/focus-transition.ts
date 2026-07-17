// Generic focus-park primitives. Stars use these now; clouds, planets,
// and any future click-focusable type are expected to compose them with
// their own R_pc / dMinFloor inputs so the focus UX stays uniform.

import * as THREE from 'three';
import { AU_PC } from '../../util/astronomy-constants';
import {
  type ArrivalState,
  newArrival,
  tickArrival,
} from '../arrival/camera-motion';

export interface ParkDistanceInputs {
  /** Effective object radius in parsecs (Reff for stars; major semi-axis
   *  for clouds; etc). */
  R_pc: number;
  /** Type-specific manual-zoom floor — the distance at which a free-orbit
   *  user can no longer pull the camera in. For stars this is the 90 %-fill
   *  floor; clouds will pass their analogue. */
  dMinFloor: number;
}

/**
 * Where the camera auto-parks when focusing an object. Lands 1 AU outside
 * the object's surface — close enough that Sol parks at ~1.005 AU (just
 * outside Earth's orbit) — but never closer than the manual-zoom floor.
 */
export function parkDistance(opts: ParkDistanceInputs): number {
  return Math.max(AU_PC + opts.R_pc, opts.dMinFloor);
}

/** Recommended viewing distance for an extended body (cloud, galaxy):
 *  2.4 × the longest semi-axis so the silhouette fits lengthwise in
 *  view — tan(half-FoV) at the 60° vertical FoV with margin — with a
 *  floor so tiny bodies don't park the camera on their surface. */
export function viewingDistanceForExtent(maxAxisPc: number, floorPc = 5): number {
  return Math.max(maxAxisPc * 2.4, floorPc);
}

/** The focus-park lerp is one of the three park-arrival sites that share
 *  `camera-motion`'s `ArrivalState`. The alias preserves the historic name
 *  so call sites that hold the state slot don't have to track a rename. */
export type FocusLerpState = ArrivalState;

/**
 * Build a focus lerp from the current camera pose. The destination is the
 * point at `parkDist` from `target`, along the current eye-to-target line —
 * so the camera glides in along its existing viewing direction rather than
 * jumping sideways. Orientation slerps in parallel: starting from
 * `cameraQuat`, ending at "looking at `target` from `toPos` with `cameraUp`
 * as up." Both interpolations are driven by the same smoothstep so the
 * camera continuously reorients toward the new target as it flies. The
 * caller must build this **after** any floating-origin recentre — every
 * vector here is in the post-recentre local frame.
 */
export function newFocusLerpFrom(
  cameraPos: THREE.Vector3,
  cameraQuat: THREE.Quaternion,
  cameraUp: THREE.Vector3,
  target: THREE.Vector3,
  parkDist: number,
  durationMs: number,
  startTimeMs: number,
  easeUFn?: (u: number) => number,
): FocusLerpState {
  const offset = new THREE.Vector3().subVectors(cameraPos, target);
  if (offset.lengthSq() === 0) offset.set(0, 0, 1);
  offset.normalize().multiplyScalar(parkDist);
  const toPos = new THREE.Vector3().addVectors(target, offset);

  // End orientation: place a scratch PerspectiveCamera at toPos with the
  // camera's up, look at target. Its quaternion is the camera orientation
  // we want at lerp end. (Object3D.lookAt swaps axes for non-cameras —
  // we need the camera-flavoured variant that orients -Z at the target.)
  const endPose = new THREE.PerspectiveCamera();
  endPose.position.copy(toPos);
  endPose.up.copy(cameraUp);
  endPose.lookAt(target);

  return newArrival({
    pStart: cameraPos,
    pEnd: toPos,
    qStart: cameraQuat,
    qEnd: endPose.quaternion,
    target: { center: target, parkDist },
    startMs: startTimeMs,
    durationMs,
    easeUFn,
  });
}

/**
 * Advance the lerp. Writes the eased position into `camera.position` and
 * the slerped orientation into `camera.quaternion`. Returns true while
 * the lerp is still in flight, false once it has landed at `pEnd`.
 */
export function tickFocusLerp(
  state: FocusLerpState,
  nowMs: number,
  camera: THREE.PerspectiveCamera,
): boolean {
  const { done } = tickArrival(state, nowMs, camera);
  return !done;
}

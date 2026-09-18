// Which slots a frustum-mode dispatch marches, and the view it tests
// against. README.md § Only what is in frame.

import { Matrix4, type Camera, type Vector3 } from 'three';

/** see README.md § Only what is in frame */
export const EXTINCTION_FRUSTUM_SLACK_PX = 256;

export function slotRefills(
  inFrame: boolean,
  pinned: boolean,
  stamp: number,
  generation: number,
): boolean {
  if (!inFrame && !pinned) return false;
  return stamp !== generation;
}

const originShift = new Matrix4();

/** projection × view × T(−worldOffset), for an ABSOLUTE position.
 *
 *  The `projection × view` half is the compaction kernel's own
 *  (`../../star/compaction/star-compaction.ts` `dispatch`), and the two are
 *  only the same test while both read the camera at the same point in the
 *  frame — `../../../stellata.ts` `animate` runs this one after the ride
 *  fan-out for that reason. `updateMatrixWorld` first for the same reason it
 *  does: the controls mutate position and quaternion without propagating. */
export function composeViewProjectionAbs(
  camera: Camera,
  worldOffset: Vector3,
  out: Matrix4,
): Matrix4 {
  camera.updateMatrixWorld();
  out.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  originShift.makeTranslation(-worldOffset.x, -worldOffset.y, -worldOffset.z);
  return out.multiply(originShift);
}

export function sameView(a: Matrix4 | null, b: Matrix4): boolean {
  if (a === null) return false;
  for (let i = 0; i < 16; i++) if (a.elements[i] !== b.elements[i]) return false;
  return true;
}

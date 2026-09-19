// Which slots a frustum-mode dispatch marches, and the view it tests
// against. README.md § Only what is in frame.

import { Matrix4, type Camera, type Vector3 } from 'three';
import { starQuadOffscreen } from '../../star/compaction/compaction-pure';

/** see README.md § Only what is in frame */
export const EXTINCTION_FRUSTUM_SLACK_PX = 256;

/** How many of `count` absolute positions the frustum-mode kernel tests past
 *  the frustum at this view — README.md § Counting the in-frame population. */
export function countInFrameAbs(
  positions: Float32Array,
  count: number,
  viewProjectionAbs: Matrix4,
  viewportW: number,
  viewportH: number,
  pinned: number,
): number {
  const e = viewProjectionAbs.elements;
  let seen = 0;
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const clipX = e[0] * x + e[4] * y + e[8] * z + e[12];
    const clipY = e[1] * x + e[5] * y + e[9] * z + e[13];
    const clipW = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (i === pinned
      || !starQuadOffscreen(clipX, clipY, clipW, EXTINCTION_FRUSTUM_SLACK_PX, viewportW, viewportH)) {
      seen++;
    }
  }
  return seen;
}

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

/** projection × view × T(−worldOffset), for an ABSOLUTE position. The same
 *  test as the compaction's only while both read the camera at the same
 *  point in the frame (README.md § Only what is in frame). */
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

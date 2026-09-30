// ORB on the wire: the frame a locked pose is written in, and the pose read
// through it. See README.md.

import type * as THREE from 'three';
import type { Stellata } from '../../../stellata';
import type { Target } from '../../../camera/focus/focus-target';
import { poseIntoFrame, type ReferenceFrame } from '../../../attitude/attitude-pure';
import { anchoredPose } from '../anchored-pose';

// An orbit-relative pose omits `up` when level on ORB, and ORB's pole in its
// own components is +z.
export const ORB_LEVEL_UP: [number, number, number] = [0, 0, 1];

/** ORB for the focus as it stands now, or null when there is none to read. */
export function orbitFrameNow(stellata: Stellata): ReferenceFrame | null {
  const read = stellata.getOrbitFramePort()?.orbitFrame();
  return read?.status === 'ready' ? read.value : null;
}

/** The frame the pose was written in, or null for ICRS.
 *  README.md#an-orbit-relative-pose */
export function wirePose(
  stellata: Stellata,
  focused: Target | null,
  outCam: THREE.Vector3,
  outTgt: THREE.Vector3,
  outUp: THREE.Vector3,
): ReferenceFrame | null {
  anchoredPose(stellata, focused, outCam, outTgt);
  outUp.copy(stellata.camera.up);
  const frame = stellata.getOrbitFramePort()?.isLocked() ? orbitFrameNow(stellata) : null;
  if (frame !== null) poseIntoFrame(outCam, outTgt, outUp, frame);
  return frame;
}

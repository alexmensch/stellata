// Pose conversion between ICRS and a frame's components. See README.md#an-orbit-relative-pose.

import type { ReferenceFrame } from '../../../attitude/attitude-pure';

export interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

type Vec3Like = Readonly<MutableVec3>;

/** In place, into (zero longitude, east, pole). `tgt` stays ICRS. */
export function poseIntoFrame(
  cam: MutableVec3, tgt: Vec3Like, up: MutableVec3, frame: ReferenceFrame,
): void {
  intoFrame(cam, tgt, frame);
  intoFrame(up, ORIGIN, frame);
}

/** The inverse of `poseIntoFrame`, in place. */
export function poseOutOfFrame(
  cam: MutableVec3, tgt: Vec3Like, up: MutableVec3, frame: ReferenceFrame,
): void {
  outOfFrame(cam, tgt, frame);
  outOfFrame(up, ORIGIN, frame);
}

const ORIGIN: Vec3Like = { x: 0, y: 0, z: 0 };

function intoFrame(v: MutableVec3, about: Vec3Like, frame: ReferenceFrame): void {
  const ox = v.x - about.x;
  const oy = v.y - about.y;
  const oz = v.z - about.z;
  const { zeroLon: a, east: b, pole: c } = frame;
  v.x = about.x + ox * a.x + oy * a.y + oz * a.z;
  v.y = about.y + ox * b.x + oy * b.y + oz * b.z;
  v.z = about.z + ox * c.x + oy * c.y + oz * c.z;
}

function outOfFrame(v: MutableVec3, about: Vec3Like, frame: ReferenceFrame): void {
  const c0 = v.x - about.x;
  const c1 = v.y - about.y;
  const c2 = v.z - about.z;
  const { zeroLon: a, east: b, pole: c } = frame;
  v.x = about.x + c0 * a.x + c1 * b.x + c2 * c.x;
  v.y = about.y + c0 * a.y + c1 * b.y + c2 * c.y;
  v.z = about.z + c0 * a.z + c1 * b.z + c2 * c.z;
}

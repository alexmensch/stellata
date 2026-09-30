// Holder for a pose awaiting the ORB tick. See README.md#a-pose-held-for-orb.

import { poseOutOfFrame, type MutableVec3, type ReferenceFrame } from '../attitude-pure';

type Vec3 = Readonly<MutableVec3>;

interface Held {
  offset: MutableVec3;
  up: MutableVec3;
  settle: () => void;
  release: () => void;
}

export class HeldOrbitPose {
  private held: Held | null = null;
  private readonly seatCam: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly seatUp: MutableVec3 = { x: 0, y: 0, z: 0 };

  /** `holdFrames` returns its own release. */
  constructor(private readonly holdFrames: () => () => void) {}

  get pending(): boolean {
    return this.held !== null;
  }

  hold(offset: Vec3, up: Vec3): Promise<void> {
    this.drop();
    return new Promise((settle) => {
      this.held = {
        offset: { x: offset.x, y: offset.y, z: offset.z },
        up: { x: up.x, y: up.y, z: up.z },
        settle,
        release: this.holdFrames(),
      };
    });
  }

  drop(): void {
    const held = this.held;
    if (held === null) return;
    this.held = null;
    held.release();
    held.settle();
  }

  /** True when it wrote; the caller then owes the camera its quaternion. */
  seat(
    frame: ReferenceFrame,
    position: MutableVec3,
    up: MutableVec3,
    pivot: Vec3,
    declined: boolean,
  ): boolean {
    const held = this.held;
    if (held === null) return false;
    if (declined) {
      this.drop();
      return false;
    }
    const c = this.seatCam;
    c.x = pivot.x + held.offset.x;
    c.y = pivot.y + held.offset.y;
    c.z = pivot.z + held.offset.z;
    const u = this.seatUp;
    u.x = held.up.x; u.y = held.up.y; u.z = held.up.z;
    poseOutOfFrame(c, pivot, u, frame);
    position.x = c.x; position.y = c.y; position.z = c.z;
    up.x = u.x; up.y = u.y; up.z = u.z;
    this.drop();
    return true;
  }
}

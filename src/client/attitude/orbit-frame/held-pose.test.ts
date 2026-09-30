import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { captureOrbitFrame, poseIntoFrame } from '../attitude-pure';
import { HeldOrbitPose } from './held-pose';

const frame = captureOrbitFrame(
  new THREE.PerspectiveCamera(),
  new THREE.Vector3(0.3, -0.2, 0.93).normalize(),
  new THREE.Vector3(-4, 1, 0.5),
);

function harness() {
  const gate = { holds: 0 };
  const held = new HeldOrbitPose(() => {
    gate.holds += 1;
    return () => { gate.holds -= 1; };
  });
  const position = { x: 9, y: 9, z: 9 };
  const up = { x: 0, y: 1, z: 0 };
  return { held, gate, position, up };
}

describe('HeldOrbitPose', () => {
  it('seats the pose about the pivot, out of the frame', async () => {
    const { held, position, up } = harness();
    const pivot = { x: 1, y: 2, z: 3 };
    const settled = held.hold({ x: 2, y: -1, z: 0.5 }, { x: 0, y: 0, z: 1 });
    expect(held.seat(frame, position, up, pivot, false)).toBe(true);
    await settled;

    // Read back into the frame: the same components it was handed.
    const cam = { ...position };
    const u = { ...up };
    poseIntoFrame(cam, pivot, u, frame);
    expect(cam.x - pivot.x).toBeCloseTo(2, 12);
    expect(cam.y - pivot.y).toBeCloseTo(-1, 12);
    expect(cam.z - pivot.z).toBeCloseTo(0.5, 12);
    expect(u.z).toBeCloseTo(1, 12);
    expect(held.pending).toBe(false);
  });

  it('keeps frames drawing only while a pose waits', () => {
    const { held, gate, position, up } = harness();
    void held.hold({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(gate.holds).toBe(1);
    held.seat(frame, position, up, { x: 0, y: 0, z: 0 }, false);
    expect(gate.holds).toBe(0);
  });

  // The user took the view while it waited: theirs wins, as for a late focus.
  it('drops a declined pose without writing, and still settles', async () => {
    const { held, position, up } = harness();
    const settled = held.hold({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(held.seat(frame, position, up, { x: 0, y: 0, z: 0 }, true)).toBe(false);
    await settled;
    expect(position).toEqual({ x: 9, y: 9, z: 9 });
  });

  it('lets a later hold supersede an earlier one', async () => {
    const { held, gate } = harness();
    const first = held.hold({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    void held.hold({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 });
    await first;
    expect(gate.holds).toBe(1);
    expect(held.pending).toBe(true);
  });

  it('writes nothing with no pose held', () => {
    const { held, position, up } = harness();
    expect(held.seat(frame, position, up, { x: 0, y: 0, z: 0 }, false)).toBe(false);
    expect(position).toEqual({ x: 9, y: 9, z: 9 });
  });
});

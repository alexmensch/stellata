import { describe, expect, it } from 'vitest';
import { Matrix4, PerspectiveCamera, Vector3, Vector4 } from 'three';
import { starQuadOffscreen } from '../../star/compaction/compaction-pure';
import {
  EXTINCTION_FRUSTUM_SLACK_PX, composeViewProjectionAbs, countInFrameAbs, sameView, slotRefills,
} from './refill-decision-pure';

// The slack is a stated bound, not a tuning knob — README.md § Only what is
// in frame argues the failure mode from this number.
it('pins the frustum slack the README states, in px', () => {
  expect(EXTINCTION_FRUSTUM_SLACK_PX).toBe(256);
});

describe('slotRefills', () => {
  it('marches an in-frame star whose stamp predates the generation', () => {
    expect(slotRefills(true, false, 3, 4)).toBe(true);
  });

  it('skips an in-frame star already stamped at this generation', () => {
    expect(slotRefills(true, false, 4, 4)).toBe(false);
  });

  it('leaves an out-of-frame star alone whatever its stamp', () => {
    expect(slotRefills(false, false, 0, 4)).toBe(false);
  });

  it('treats the pinned star as in frame', () => {
    expect(slotRefills(false, true, 3, 4)).toBe(true);
    expect(slotRefills(false, true, 4, 4)).toBe(false);
  });
});

describe('composeViewProjectionAbs', () => {
  it('maps an absolute position to the clip compaction would compute from the local one', () => {
    const camera = new PerspectiveCamera(60, 1.6, 0.1, 1000);
    camera.position.set(1, 2, 3);
    camera.lookAt(0, 0, 0);
    const offset = new Vector3(100, -50, 7);
    const vpAbs = composeViewProjectionAbs(camera, offset, new Matrix4());
    const vpLocal = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const local = new Vector3(0.3, -0.2, -5);
    const abs = local.clone().add(offset);
    const a = new Vector4(abs.x, abs.y, abs.z, 1).applyMatrix4(vpAbs);
    const b = new Vector4(local.x, local.y, local.z, 1).applyMatrix4(vpLocal);
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.y).toBeCloseTo(b.y, 9);
    expect(a.w).toBeCloseTo(b.w, 9);
  });
});

describe('sameView', () => {
  it('is false against no view, true for equal elements, false for a moved camera', () => {
    const camera = new PerspectiveCamera(60, 1.6, 0.1, 1000);
    const a = composeViewProjectionAbs(camera, new Vector3(), new Matrix4());
    expect(sameView(null, a)).toBe(false);
    expect(sameView(a, a.clone())).toBe(true);
    camera.rotateY(0.01);
    const b = composeViewProjectionAbs(camera, new Vector3(), new Matrix4());
    expect(sameView(a, b)).toBe(false);
  });
});

describe('rotation without translation', () => {
  const W = 1600;
  const H = 900;
  const stars: Vector3[] = [];
  for (let x = -3; x <= 3; x++) {
    for (let y = -3; y <= 3; y++) {
      for (let z = -3; z <= 3; z++) stars.push(new Vector3(x * 40, y * 40, z * 40));
    }
  }
  const inFrame = (vpAbs: Matrix4) => stars.map((s) => {
    const c = new Vector4(s.x, s.y, s.z, 1).applyMatrix4(vpAbs);
    return !starQuadOffscreen(c.x, c.y, c.w, EXTINCTION_FRUSTUM_SLACK_PX, W, H);
  });
  const camera = new PerspectiveCamera(50, W / H, 0.01, 1e4);
  camera.position.set(5, 5, 5);
  camera.lookAt(120, 0, 0);
  const view1 = composeViewProjectionAbs(camera, new Vector3(), new Matrix4());
  // ~34° of yaw against a ~40° horizontal half-FOV: the two views overlap
  // and each sees stars the other does not.
  camera.lookAt(120, 80, 0);
  const view2 = composeViewProjectionAbs(camera, new Vector3(), new Matrix4());

  it('exposes a different set of stars, with some overlap', () => {
    const s1 = inFrame(view1);
    const s2 = inFrame(view2);
    const both = s1.filter((v, i) => v && s2[i]).length;
    const only2 = s2.filter((v, i) => v && !s1[i]).length;
    expect(s1.filter(Boolean).length).toBeGreaterThan(0);
    expect(only2).toBeGreaterThan(0);
    expect(both).toBeGreaterThan(0);
  });

  it('marches exactly the newly exposed stars, and no star twice per generation', () => {
    const generation = 7;
    const stamps = new Array<number>(stars.length).fill(generation - 1);
    const s1 = inFrame(view1);
    const marched1 = stars.map((_, i) => slotRefills(s1[i], false, stamps[i], generation));
    marched1.forEach((m, i) => { if (m) stamps[i] = generation; });
    expect(marched1).toEqual(s1);

    const s2 = inFrame(view2);
    const marched2 = stars.map((_, i) => slotRefills(s2[i], false, stamps[i], generation));
    const newlyExposed = s2.map((v, i) => v && !s1[i]);
    expect(marched2).toEqual(newlyExposed);
    expect(marched2.some(Boolean)).toBe(true);

    // A second sweep at the same view and generation marches nothing.
    marched2.forEach((m, i) => { if (m) stamps[i] = generation; });
    expect(stars.map((_, i) => slotRefills(s2[i], false, stamps[i], generation)).some(Boolean))
      .toBe(false);
  });

  it('a camera generation bump re-marches everything in frame, once', () => {
    const stamps = new Array<number>(stars.length).fill(7);
    const s2 = inFrame(view2);
    expect(stars.map((_, i) => slotRefills(s2[i], false, stamps[i], 8))).toEqual(s2);
  });

  describe('countInFrameAbs', () => {
    const positions = new Float32Array(stars.length * 3);
    stars.forEach((s, i) => { positions[i * 3] = s.x; positions[i * 3 + 1] = s.y; positions[i * 3 + 2] = s.z; });

    it('counts exactly the stars the per-star rule admits, at either view', () => {
      for (const view of [view1, view2]) {
        const expected = inFrame(view).filter(Boolean).length;
        expect(expected).toBeGreaterThan(0);
        expect(expected).toBeLessThan(stars.length);
        expect(countInFrameAbs(positions, stars.length, view, W, H, -1)).toBe(expected);
      }
    });

    it('counts the pinned focal star as seen wherever it projects', () => {
      const s1 = inFrame(view1);
      const behind = s1.findIndex((v) => !v);
      expect(behind).toBeGreaterThanOrEqual(0);
      const plain = countInFrameAbs(positions, stars.length, view1, W, H, -1);
      expect(countInFrameAbs(positions, stars.length, view1, W, H, behind)).toBe(plain + 1);
      const seen = s1.findIndex(Boolean);
      expect(countInFrameAbs(positions, stars.length, view1, W, H, seen)).toBe(plain);
    });

    it('reads zero over a catalogue entirely behind the camera', () => {
      const camera = new PerspectiveCamera(50, W / H, 0.01, 1e4);
      camera.position.set(0, 0, -1000);
      camera.lookAt(0, 0, -2000);
      const away = composeViewProjectionAbs(camera, new Vector3(), new Matrix4());
      expect(countInFrameAbs(positions, stars.length, away, W, H, -1)).toBe(0);
    });
  });
});

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { projectToScreenInto } from './overlay-project';

function makeCamera(opts: { fov?: number; aspect?: number; near?: number; far?: number } = {}) {
  const cam = new THREE.PerspectiveCamera(
    opts.fov ?? 50,
    opts.aspect ?? 1,
    opts.near ?? 0.01,
    opts.far ?? 1000,
  );
  cam.position.set(0, 0, 0);
  cam.lookAt(0, 0, -1);
  cam.updateMatrixWorld(true);
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  cam.updateProjectionMatrix();
  return cam;
}

describe('overlay-project / projectToScreenInto', () => {
  const W = 800;
  const H = 600;

  it('puts a point on the view axis at the viewport centre', () => {
    // Absolute, rather than differenced against a second implementation:
    // the allocating twin this used to compare with is gone, and one
    // projector with no reference to check against needs a pinned value.
    const cam = makeCamera();
    const out: [number, number] = [0, 0];
    expect(projectToScreenInto(new THREE.Vector3(0, 0, -10), cam, W, H, out)).toBe(true);
    expect(out).toEqual([W / 2, H / 2]);
  });

  it('maps +x right and +y up, in CSS-pixel space', () => {
    const cam = makeCamera();
    const out: [number, number] = [0, 0];
    projectToScreenInto(new THREE.Vector3(1, 1, -10), cam, W, H, out);
    expect(out[0]).toBeGreaterThan(W / 2);
    expect(out[1]).toBeLessThan(H / 2);
  });

  it('returns false and leaves out untouched when at/behind the near plane', () => {
    const cam = makeCamera({ near: 0.5 });
    const p = new THREE.Vector3(0, 0, -0.5);
    const out: [number, number] = [7, 9];
    const ok = projectToScreenInto(p, cam, W, H, out);
    expect(ok).toBe(false);
    expect(out).toEqual([7, 9]);
  });

  it('reuses the same out array across calls without cross-call contamination', () => {
    const cam = makeCamera();
    const out: [number, number] = [0, 0];
    projectToScreenInto(new THREE.Vector3(-1, 0, -10), cam, W, H, out);
    const first = [...out];
    projectToScreenInto(new THREE.Vector3(1, 0, -10), cam, W, H, out);
    const second = [...out];
    expect(second).not.toEqual(first);
    expect(out).toEqual(second);
  });
});

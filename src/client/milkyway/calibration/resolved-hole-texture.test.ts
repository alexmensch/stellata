import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  RESOLVED_HOLE_GRID_HALF_PC,
  RESOLVED_HOLE_GRID_N,
  unresolvedHoleVoxels,
} from './resolved-fraction-pure';
import { makeResolvedHoleTexture, writeResolvedHoleTexture } from './resolved-hole-texture';

const voxelAt = (tex: THREE.Data3DTexture, i: number) =>
  THREE.DataUtils.fromHalfFloat((tex.image.data as Uint16Array)[i]);

const index = (ix: number, iy: number, iz: number) =>
  (iz * RESOLVED_HOLE_GRID_N + iy) * RESOLVED_HOLE_GRID_N + ix;

describe('the resolution-hole grid', () => {
  // README.md#the-table-is-a-3d-grid-not-a-uniform-array — every one
  // of these is load-bearing.
  it('is a 64-cube half-float red texture, linear and clamped on all three axes', () => {
    const tex = makeResolvedHoleTexture();
    expect(tex.image.width).toBe(RESOLVED_HOLE_GRID_N);
    expect(tex.image.height).toBe(RESOLVED_HOLE_GRID_N);
    expect(tex.image.depth).toBe(RESOLVED_HOLE_GRID_N);
    expect(tex.format).toBe(THREE.RedFormat);
    expect(tex.type).toBe(THREE.HalfFloatType);
    expect(tex.minFilter).toBe(THREE.LinearFilter);
    expect(tex.magFilter).toBe(THREE.LinearFilter);
    expect(tex.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(tex.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(tex.wrapR).toBe(THREE.ClampToEdgeWrapping);
    expect(tex.flipY).toBe(false);
    expect(tex.generateMipmaps).toBe(false);
  });

  // x fastest, then y, then z, which is what makes the shader's
  // `fromSol / span + 0.5` land on the cell that owns the point.
  it('lays the cube out x fastest, and Sol sits at the centre', () => {
    const tex = makeResolvedHoleTexture();
    writeResolvedHoleTexture(tex);
    const expected = unresolvedHoleVoxels();
    for (const [ix, iy, iz] of [[0, 0, 0], [32, 32, 32], [63, 0, 17], [8, 40, 63]]) {
      const i = index(ix, iy, iz);
      expect(voxelAt(tex, i)).toBeCloseTo(expected[i], 3);
    }
    expect(voxelAt(tex, index(32, 32, 32))).toBeLessThan(0.1);
    expect(voxelAt(tex, index(0, 0, 0))).toBeGreaterThan(0.99);
  });

  // `version` is what a re-upload is keyed on, so a write that did not
  // bump it would leave the GPU on the previous slider position — and
  // nothing else in the frame touches this texture.
  it('writes in place and re-uploads only on a write', () => {
    const tex = makeResolvedHoleTexture();
    expect(voxelAt(tex, index(18, 0, 0))).toBe(0);
    const data = tex.image.data;
    const version = tex.version;

    writeResolvedHoleTexture(tex);
    expect(tex.image.data).toBe(data);
    expect(tex.version).toBe(version + 1);

    writeResolvedHoleTexture(tex, 0);
    expect(tex.version).toBe(version + 2);
    // Hole off: the band owes the whole of the model's light again.
    const n = RESOLVED_HOLE_GRID_N ** 3;
    for (let i = 0; i < n; i += 997) expect(voxelAt(tex, i)).toBe(1);
  });

  it('spans the cube the shaders divide by', () => {
    expect(RESOLVED_HOLE_GRID_HALF_PC).toBe(4000);
  });
});

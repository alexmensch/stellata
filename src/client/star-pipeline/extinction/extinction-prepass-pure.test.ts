import { describe, it, expect } from 'vitest';
import {
  AV_TEX_WIDTH,
  RECOMPUTE_EPSILON_PC,
  avTexHeight,
  packPositionsRgba,
  movedBeyondEpsilon,
} from './extinction-prepass-pure';
import { fullscreenTriangleGeometry } from './extinction-prepass';

describe('fullscreenTriangleGeometry', () => {
  it('is indexed — without an index or a position attribute the renderer resolves draw count to 0', () => {
    const geometry = fullscreenTriangleGeometry();
    expect(geometry.attributes.position).toBeUndefined();
    expect(geometry.index?.count).toBe(3);
  });
});

describe('avTexHeight', () => {
  it('covers the shipping catalog in 306 rows of 1024', () => {
    expect(AV_TEX_WIDTH).toBe(1024);
    expect(avTexHeight(313_242)).toBe(306);
  });

  it('rounds up at row boundaries', () => {
    expect(avTexHeight(1024)).toBe(1);
    expect(avTexHeight(1025)).toBe(2);
  });
});

describe('packPositionsRgba', () => {
  it('places xyz at the star-index texel and zero-fills padding', () => {
    const positions = new Float32Array([1, 2, 3, 4, 5, 6]);
    const out = packPositionsRgba(positions, 2);
    expect(out.length).toBe(AV_TEX_WIDTH * 4);
    expect([out[0], out[1], out[2], out[3]]).toEqual([1, 2, 3, 0]);
    expect([out[4], out[5], out[6], out[7]]).toEqual([4, 5, 6, 0]);
    expect(out[8]).toBe(0);
    expect(out[out.length - 4]).toBe(0);
  });
});

describe('movedBeyondEpsilon', () => {
  it('is false at exactly epsilon and true just beyond', () => {
    expect(movedBeyondEpsilon(0, 0, 0, RECOMPUTE_EPSILON_PC, 0, 0, RECOMPUTE_EPSILON_PC)).toBe(false);
    expect(movedBeyondEpsilon(0, 0, 0, RECOMPUTE_EPSILON_PC + 1e-3, 0, 0, RECOMPUTE_EPSILON_PC)).toBe(true);
  });

  it('always fires on the Infinity first-frame sentinel', () => {
    expect(movedBeyondEpsilon(Infinity, Infinity, Infinity, 0, 0, 0, RECOMPUTE_EPSILON_PC)).toBe(true);
  });
});

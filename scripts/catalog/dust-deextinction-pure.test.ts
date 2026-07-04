import { describe, it, expect } from 'vitest';
import {
  R_V,
  sampleDensityAt,
  avSolToStar,
  type DustGrid,
} from './dust-deextinction-pure';

// densityMax = densityMin · exp(logRatio); byte 255 decodes to densityMax,
// byte 0 to densityMin.
function uniformGrid(byte: number, over: Partial<DustGrid> = {}): DustGrid {
  const gridSize = over.gridSize ?? 4;
  const boundsHalfPc = over.boundsHalfPc ?? 100;
  return {
    gridSize,
    boundsHalfPc,
    densityMin: 1e-3,
    logRatio: Math.log(100), // densityMax = 0.1
    avPerDensityPc: 2,
    voxelSizePc: (2 * boundsHalfPc) / gridSize,
    data: new Uint8Array(gridSize * gridSize * gridSize).fill(byte),
    ...over,
  };
}

describe('sampleDensityAt', () => {
  it('decodes byte 255 to densityMax and byte 0 to densityMin', () => {
    expect(sampleDensityAt(uniformGrid(255), 0, 0, 0)).toBeCloseTo(0.1, 12);
    expect(sampleDensityAt(uniformGrid(0), 0, 0, 0)).toBeCloseTo(1e-3, 12);
  });

  it('returns 0 outside the cube (shader continue + zero-padding)', () => {
    const g = uniformGrid(255);
    expect(sampleDensityAt(g, 150, 0, 0)).toBe(0);
    expect(sampleDensityAt(g, 0, -101, 0)).toBe(0);
  });

  it('trilinearly interpolates in encoded space at a cell centre', () => {
    // 2³ grid; sampling the geometric centre (uvw = 0.5) averages all
    // eight corners in normalised-encoded space before decoding.
    const data = new Uint8Array(8);
    // x-fastest: idx = (z·2 + y)·2 + x
    data[0] = 0;   // (0,0,0)
    data[1] = 255; // (1,0,0)
    data[2] = 0;   // (0,1,0)
    data[3] = 255; // (1,1,0)
    data[4] = 0;   // (0,0,1)
    data[5] = 255; // (1,0,1)
    data[6] = 0;   // (0,1,1)
    data[7] = 255; // (1,1,1)
    const g: DustGrid = {
      gridSize: 2, boundsHalfPc: 100, densityMin: 1e-3,
      logRatio: Math.log(100), avPerDensityPc: 2, voxelSizePc: 100, data,
    };
    // Mean encoded = 0.5 → density = 1e-3·exp(0.5·ln100) = 1e-3·10 = 0.01.
    expect(sampleDensityAt(g, 0, 0, 0)).toBeCloseTo(0.01, 12);
  });
});

describe('avSolToStar', () => {
  it('is zero at the origin', () => {
    expect(avSolToStar(uniformGrid(255), 0, 0, 0)).toBe(0);
  });

  it('scales A_V = density · pathLength · avPerDensityPc for uniform dust', () => {
    // Star at 50 pc along +x, cube half-width 100 pc: whole ray is in-cube.
    // density = 0.1, avPerDensityPc = 2 → A_V = 0.1 · 50 · 2 = 10.
    expect(avSolToStar(uniformGrid(255), 50, 0, 0)).toBeCloseTo(10, 6);
  });

  it('integrates only the in-cube segment for stars beyond the cube', () => {
    // Star at 500 pc along +x; ray exits the 100 pc half-cube at 100 pc.
    // A_V = 0.1 · 100 · 2 = 20, independent of the star's full distance.
    expect(avSolToStar(uniformGrid(255), 500, 0, 0)).toBeCloseTo(20, 6);
  });

  it('is near zero through empty (densityMin) dust', () => {
    // byte 0 → densityMin 1e-3; A_V over 50 pc = 1e-3·50·2 = 0.1.
    expect(avSolToStar(uniformGrid(0), 50, 0, 0)).toBeCloseTo(0.1, 6);
  });
});

describe('R_V', () => {
  it('is the canonical interstellar reddening ratio', () => {
    expect(R_V).toBe(3.1);
  });
});

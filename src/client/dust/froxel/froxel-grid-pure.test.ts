import { describe, expect, it } from 'vitest';
import {
  ROTATION_EPSILON_RAD,
  coverageSpanPc,
  fillSamplesPerRay,
  frustumCells,
  frustumScreenExtent,
  froxelGridDims,
  rotatedBeyondEpsilon,
  sliceEdgePc,
} from './froxel-grid-pure';
import { PINNED_CELL_RAD, PINNED_SLICES } from './froxel-pins';

const ASPECT = 16 / 9;
const COVERAGE_PC = 1250;

describe('screen extent', () => {
  it('is 2 tan(fov/2) vertically and aspect times that horizontally', () => {
    const e = frustumScreenExtent(50, ASPECT);
    expect(e.y).toBeCloseTo(2 * Math.tan((25 * Math.PI) / 180), 12);
    expect(e.x / e.y).toBeCloseTo(ASPECT, 12);
  });
});

describe('cell counts', () => {
  it('counts a screen grid in tan space — 108.0k cells at the 50 deg pin', () => {
    expect(frustumCells(50, ASPECT, PINNED_CELL_RAD) / 1e3).toBeCloseTo(107.95, 2);
  });

  it('scales quadratically in cell angle — the fallback lever', () => {
    const coarse = frustumCells(50, ASPECT, 2 * PINNED_CELL_RAD);
    expect(coarse / frustumCells(50, ASPECT, PINNED_CELL_RAD)).toBeCloseTo(0.25, 12);
  });

  it('allocates the ceil of the same geometry', () => {
    const dims = froxelGridDims(50, ASPECT, PINNED_CELL_RAD);
    expect(dims).toEqual({ x: 439, y: 247 });
    expect(froxelGridDims(120, ASPECT, PINNED_CELL_RAD)).toEqual({ x: 1628, y: 916 });
  });
});

describe('coverage span', () => {
  it('runs from the near clamp to the full radius from Sol, whatever the direction', () => {
    for (const dir of [[1, 0, 0], [0, 0, -1], [0.6, 0.8, 0]] as const) {
      const span = coverageSpanPc(0, 0, 0, dir[0], dir[1], dir[2], COVERAGE_PC);
      expect(span).not.toBeNull();
      expect(span!.near).toBeCloseTo(0, 9);
      expect(span!.far).toBeCloseTo(COVERAGE_PC, 9);
    }
  });

  it('starts at the near root from outside coverage — requirement 4', () => {
    const span = coverageSpanPc(3000, 0, 0, -1, 0, 0, COVERAGE_PC);
    expect(span!.near).toBeCloseTo(1750, 9);
    expect(span!.far).toBeCloseTo(4250, 9);
  });

  it('is null for a sightline that misses, and for one facing away', () => {
    expect(coverageSpanPc(3000, 0, 0, 0, 1, 0, COVERAGE_PC)).toBeNull();
    expect(coverageSpanPc(3000, 0, 0, 1, 0, 0, COVERAGE_PC)).toBeNull();
  });
});

describe('slices', () => {
  it('spans exactly [near, far] at the edges and is log-spaced between', () => {
    expect(sliceEdgePc(0, PINNED_SLICES, 1, COVERAGE_PC)).toBeCloseTo(1, 12);
    expect(sliceEdgePc(PINNED_SLICES, PINNED_SLICES, 1, COVERAGE_PC))
      .toBeCloseTo(COVERAGE_PC, 9);
    const a = sliceEdgePc(5, PINNED_SLICES, 1, COVERAGE_PC);
    const b = sliceEdgePc(6, PINNED_SLICES, 1, COVERAGE_PC);
    const c = sliceEdgePc(7, PINNED_SLICES, 1, COVERAGE_PC);
    expect(b / a).toBeCloseTo(c / b, 12);
  });

  it('gives the outermost shell the fill loop bound the shader pins', () => {
    // The worst case is a ray crossing the full 2 x radius chord, which is
    // what MAX_FILL_STEPS in froxel-fill.frag.glsl has to cover.
    const near = 1;
    const far = 2 * COVERAGE_PC;
    const last = far - sliceEdgePc(PINNED_SLICES - 1, PINNED_SLICES, near, far);
    expect(fillSamplesPerRay(last, 4.883 / 2)).toBeLessThanOrEqual(256);
  });
});

describe('fill samples', () => {
  it('is the 512 per ray the cost model prices from Sol', () => {
    expect(fillSamplesPerRay(COVERAGE_PC - 1, 4.883 / 2)).toBe(512);
  });
});

describe('rotation gate', () => {
  it('holds below a fifth of a cell and trips above it', () => {
    const dotAt = (rad: number) => Math.cos(rad / 2);
    expect(rotatedBeyondEpsilon(dotAt(ROTATION_EPSILON_RAD * 0.9), ROTATION_EPSILON_RAD))
      .toBe(false);
    expect(rotatedBeyondEpsilon(dotAt(ROTATION_EPSILON_RAD * 1.1), ROTATION_EPSILON_RAD))
      .toBe(true);
  });

  it('trips on the NaN first-fill sentinel', () => {
    expect(rotatedBeyondEpsilon(NaN, ROTATION_EPSILON_RAD)).toBe(true);
  });

  it('treats a quaternion and its negation as the same pose', () => {
    expect(rotatedBeyondEpsilon(-1, ROTATION_EPSILON_RAD)).toBe(false);
  });
});

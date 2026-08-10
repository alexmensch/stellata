import { describe, expect, it } from 'vitest';
import { allSkyCells, frustumSr, screenGridOverhead } from './cost-pure';
import {
  frustumCells,
  frustumScreenExtent,
} from '../../../src/client/dust/froxel/froxel-grid-pure';
import { PINNED_CELL_RAD } from '../../../src/client/dust/froxel/froxel-pins';

const ASPECT = 16 / 9;

describe('frustum solid angle', () => {
  it('is the 1.09 sr the 50 deg default subtends', () => {
    expect(frustumSr(50, ASPECT)).toBeCloseTo(1.0924, 4);
  });

  it('gives the all-sky map 11.5x the fill area of the 50 deg cone', () => {
    expect((4 * Math.PI) / frustumSr(50, ASPECT)).toBeCloseTo(11.503, 3);
  });

  it('rises monotonically with FOV and never exceeds the sphere', () => {
    const angles = [10, 30, 50, 90, 120, 170];
    for (let i = 1; i < angles.length; i++) {
      expect(frustumSr(angles[i], ASPECT)).toBeGreaterThan(frustumSr(angles[i - 1], ASPECT));
    }
    expect(frustumSr(170, ASPECT)).toBeLessThan(4 * Math.PI);
  });
});

describe('cell counts', () => {
  it('holds 877.3k cells all-sky at the pinned cell', () => {
    expect(allSkyCells(PINNED_CELL_RAD) / 1e3).toBeCloseTo(877.3, 1);
  });

  it('counts a screen grid in tan space, not in solid angle', () => {
    const cells = frustumCells(50, ASPECT, PINNED_CELL_RAD);
    const uniformInAngle = frustumSr(50, ASPECT) / PINNED_CELL_RAD ** 2;
    expect(cells / 1e3).toBeCloseTo(107.95, 2);
    expect(cells / uniformInAngle).toBeCloseTo(1.4155, 4);
  });

  it('charges the overhead the doc quotes per FOV', () => {
    expect(screenGridOverhead(10, ASPECT)).toBeCloseTo(1.02, 2);
    expect(screenGridOverhead(50, ASPECT)).toBeCloseTo(1.42, 2);
    expect(screenGridOverhead(120, ASPECT)).toBeCloseTo(5.51, 2);
  });

  it('has an overhead that grows with FOV and bottoms out at 1 on axis', () => {
    expect(screenGridOverhead(1, ASPECT)).toBeCloseTo(1.0, 3);
    for (const fov of [10, 50, 120]) {
      expect(screenGridOverhead(fov, ASPECT)).toBeGreaterThan(1);
    }
  });

  it('scales quadratically in cell angle — the fallback lever', () => {
    const coarse = frustumCells(50, ASPECT, 2 * PINNED_CELL_RAD);
    expect(coarse / frustumCells(50, ASPECT, PINNED_CELL_RAD)).toBeCloseTo(0.25, 12);
  });
});

describe('screen extent', () => {
  it('is 2 tan(fov/2) vertically and aspect times that horizontally', () => {
    const e = frustumScreenExtent(50, ASPECT);
    expect(e.y).toBeCloseTo(2 * Math.tan((25 * Math.PI) / 180), 12);
    expect(e.x / e.y).toBeCloseTo(ASPECT, 12);
  });
});

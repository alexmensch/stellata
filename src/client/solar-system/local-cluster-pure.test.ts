import { describe, expect, it } from 'vitest';
import { AU_PC } from '../util/astronomy-constants';
import {
  isHostLocallyActive,
  RING_EXTENT_MARGIN,
  ringExtentRadiusPc,
} from './local-cluster-pure';

describe('isHostLocallyActive', () => {
  it('is active inside the cull distance (rings down)', () => {
    expect(isHostLocallyActive(3, 10, false)).toBe(true);
  });

  it('is active exactly at the cull boundary', () => {
    expect(isHostLocallyActive(10, 10, false)).toBe(true);
  });

  it('is inactive beyond the cull distance with rings down', () => {
    expect(isHostLocallyActive(11, 10, false)).toBe(false);
  });

  it('stays active beyond the cull distance while rings draw', () => {
    expect(isHostLocallyActive(11, 10, true)).toBe(true);
  });

  it('is active inside the cull distance with rings up too', () => {
    expect(isHostLocallyActive(3, 10, true)).toBe(true);
  });
});

describe('ringExtentRadiusPc', () => {
  it('is 0 with no planets', () => {
    expect(ringExtentRadiusPc([])).toBe(0);
  });

  it('is 0 when every body is a moon (parent-orbiting)', () => {
    expect(ringExtentRadiusPc([
      { parentName: 'Saturn', semiMajorAxisAu: 0.008, eccentricity: 0 },
    ])).toBe(0);
  });

  it('applies eccentricity (apoapsis = a·(1+e)) and the margin', () => {
    expect(ringExtentRadiusPc([
      { semiMajorAxisAu: 2, eccentricity: 0.5 },
    ])).toBeCloseTo(2 * 1.5 * AU_PC * RING_EXTENT_MARGIN, 20);
  });

  it('takes the outermost apoapsis and excludes moons', () => {
    const radius = ringExtentRadiusPc([
      { semiMajorAxisAu: 0.4, eccentricity: 0.2 },   // inner
      { semiMajorAxisAu: 30, eccentricity: 0.01 },   // outer, host-orbiting
      { parentName: 'Neptune', semiMajorAxisAu: 100, eccentricity: 0 }, // far moon, ignored
    ]);
    expect(radius).toBeCloseTo(30 * 1.01 * AU_PC * RING_EXTENT_MARGIN, 20);
  });

  it('margin pushes the sphere past the raw apoapsis', () => {
    const raw = 5 * AU_PC;
    expect(ringExtentRadiusPc([{ semiMajorAxisAu: 5, eccentricity: 0 }]))
      .toBeGreaterThan(raw);
  });
});

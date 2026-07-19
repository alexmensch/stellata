import { describe, expect, it } from 'vitest';
import { AU_PC } from '../util/astronomy-constants';
import {
  isHostLocallyActive,
  moonRingExtentsPc,
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
      { name: 'Titan', parentName: 'Saturn', semiMajorAxisAu: 0.008, eccentricity: 0 },
    ])).toBe(0);
  });

  it('applies eccentricity (apoapsis = a·(1+e)) and the margin', () => {
    expect(ringExtentRadiusPc([
      { name: 'A', semiMajorAxisAu: 2, eccentricity: 0.5 },
    ])).toBeCloseTo(2 * 1.5 * AU_PC * RING_EXTENT_MARGIN, 20);
  });

  it('takes the outermost apoapsis and excludes moons', () => {
    const radius = ringExtentRadiusPc([
      { name: 'A', semiMajorAxisAu: 0.4, eccentricity: 0.2 },   // inner
      { name: 'Neptune', semiMajorAxisAu: 30, eccentricity: 0.01 },   // outer, host-orbiting
      { name: 'FarMoon', parentName: 'Neptune', semiMajorAxisAu: 100, eccentricity: 0 }, // moon, ignored
    ]);
    expect(radius).toBeCloseTo(30 * 1.01 * AU_PC * RING_EXTENT_MARGIN, 20);
  });

  it('margin pushes the sphere past the raw apoapsis', () => {
    const raw = 5 * AU_PC;
    expect(ringExtentRadiusPc([{ name: 'A', semiMajorAxisAu: 5, eccentricity: 0 }]))
      .toBeGreaterThan(raw);
  });
});

describe('moonRingExtentsPc', () => {
  it('is empty with no moons', () => {
    expect(moonRingExtentsPc([
      { name: 'A', semiMajorAxisAu: 1, eccentricity: 0 },
    ]).size).toBe(0);
  });

  it('maps each moon-parenting body to its largest moon apoapsis × margin', () => {
    const extents = moonRingExtentsPc([
      { name: 'Jupiter', semiMajorAxisAu: 5.2, eccentricity: 0.05 },
      { name: 'Neptune', semiMajorAxisAu: 30, eccentricity: 0.01 },
      { name: 'Io', parentName: 'Jupiter', semiMajorAxisAu: 0.0028, eccentricity: 0.004 },
      { name: 'Callisto', parentName: 'Jupiter', semiMajorAxisAu: 0.0126, eccentricity: 0.007 },
      { name: 'Triton', parentName: 'Neptune', semiMajorAxisAu: 0.0024, eccentricity: 0 },
    ]);
    expect(extents.size).toBe(2);
    expect(extents.get(0)).toBeCloseTo(
      0.0126 * 1.007 * AU_PC * RING_EXTENT_MARGIN, 20);
    expect(extents.get(1)).toBeCloseTo(
      0.0024 * AU_PC * RING_EXTENT_MARGIN, 20);
  });

  it('ignores a moon whose parent is not in the body list', () => {
    expect(moonRingExtentsPc([
      { name: 'Orphan', parentName: 'Missing', semiMajorAxisAu: 1, eccentricity: 0 },
    ]).size).toBe(0);
  });
});

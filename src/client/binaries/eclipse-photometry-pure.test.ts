import { describe, it, expect } from 'vitest';
import {
  circleCircleLensArea,
  eclipseDim,
} from './eclipse-photometry-pure';

describe('circleCircleLensArea', () => {
  it('disjoint circles return zero', () => {
    expect(circleCircleLensArea(1, 1, 2.0001)).toBe(0);
    expect(circleCircleLensArea(0.3, 0.7, 1.5)).toBe(0);
  });

  it('one circle fully inside the other returns π·rMin²', () => {
    expect(circleCircleLensArea(2, 1, 0.5)).toBeCloseTo(Math.PI * 1, 9);
    expect(circleCircleLensArea(1, 3, 0)).toBeCloseTo(Math.PI * 1, 9);
  });

  it('equal circles concentric: full disc area', () => {
    expect(circleCircleLensArea(2, 2, 0)).toBeCloseTo(Math.PI * 4, 9);
  });

  it('equal circles half-overlapping (d = r): symmetric closed form', () => {
    // d = r1 = r2 = 1. Standard lens-area result:
    //   A = 2·r²·acos(d/(2r)) − (d/2)·√(4r² − d²)
    //     = 2·acos(0.5) − 0.5·√3 = 2π/3 − √3/2
    const expected = (2 * Math.PI) / 3 - Math.sqrt(3) / 2;
    expect(circleCircleLensArea(1, 1, 1)).toBeCloseTo(expected, 9);
  });

  it('matches the symmetric formula across the partial-overlap range', () => {
    const r = 1;
    for (let k = 1; k < 20; k++) {
      const d = (k / 20) * (2 * r); // strictly inside (0, 2r)
      const expected = 2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d);
      expect(circleCircleLensArea(r, r, d)).toBeCloseTo(expected, 9);
    }
  });

  it('tangent contact (d = r1 + r2) returns zero', () => {
    expect(circleCircleLensArea(1, 0.4, 1.4)).toBeCloseTo(0, 9);
  });

  it('inner-tangent boundary (d = |r1 − r2|) returns π·rMin²', () => {
    expect(circleCircleLensArea(2, 0.5, 1.5)).toBeCloseTo(Math.PI * 0.25, 9);
  });
});

describe('eclipseDim — degenerate inputs', () => {
  const cam = { x: 0, y: 0, z: 0 };
  const primary = { x: 0, y: 0, z: 10 };
  const secondary = { x: 0.001, y: 0, z: 10 };

  it('zero radii produce no dim', () => {
    const r = eclipseDim({
      primary, secondary, camera: cam,
      radiusPrimaryPc: 0, radiusSecondaryPc: 0,
    });
    expect(r.dim).toBe(1);
  });

  it('zero distance returns no dim (defensive)', () => {
    const r = eclipseDim({
      primary: cam, secondary, camera: cam,
      radiusPrimaryPc: 1, radiusSecondaryPc: 1,
    });
    expect(r.dim).toBe(1);
  });
});

describe('eclipseDim — no overlap', () => {
  it('wide projected separation: dim = 1', () => {
    // 1 R_sun ≈ 2.25e-8 pc; place pair 1 pc from camera with 1 pc lateral
    // separation — angular separation ≫ both angular radii.
    const cam = { x: 0, y: 0, z: 0 };
    const primary = { x: 0, y: 0, z: 1 };
    const secondary = { x: 1, y: 0, z: 1 };
    const r = eclipseDim({
      primary, secondary, camera: cam,
      radiusPrimaryPc: 2.25e-8, radiusSecondaryPc: 2.25e-8,
    });
    expect(r.dim).toBe(1);
  });
});

describe('eclipseDim — front/back determination', () => {
  // Place a small dim secondary in front of a larger bright primary,
  // collinear with the camera. The smaller front disc fully covers a
  // patch of the larger back disc; the primary is the back component
  // and carries the dim.
  it('secondary closer to camera → primary is the back', () => {
    const cam = { x: 0, y: 0, z: 0 };
    const primary = { x: 0, y: 0, z: 10 };
    const secondary = { x: 0, y: 0, z: 5 };
    const r = eclipseDim({
      primary, secondary, camera: cam,
      radiusPrimaryPc: 5e-3, radiusSecondaryPc: 5e-3,
    });
    expect(r.front).toBe('secondary');
    expect(r.dim).toBeLessThan(1);
  });

  it('primary closer to camera → secondary is the back', () => {
    const cam = { x: 0, y: 0, z: 0 };
    const primary = { x: 0, y: 0, z: 5 };
    const secondary = { x: 0, y: 0, z: 10 };
    const r = eclipseDim({
      primary, secondary, camera: cam,
      radiusPrimaryPc: 5e-3, radiusSecondaryPc: 5e-3,
    });
    expect(r.front).toBe('primary');
    expect(r.dim).toBeLessThan(1);
  });
});

describe('eclipseDim — full and partial occlusion', () => {
  it('small back fully hidden by larger front: dim = 0', () => {
    // Front disc much larger than back disc; collinear with camera.
    // Back's full disc is hidden → dim = 0.
    const cam = { x: 0, y: 0, z: 0 };
    const primary = { x: 0, y: 0, z: 10 }; // back
    const secondary = { x: 0, y: 0, z: 5 }; // front (closer + much bigger)
    const r = eclipseDim({
      primary, secondary, camera: cam,
      radiusPrimaryPc: 5e-3, radiusSecondaryPc: 0.5,
    });
    expect(r.front).toBe('secondary');
    expect(r.dim).toBeCloseTo(0, 6);
  });

  it('small front on bigger back: dim = 1 − (alpha_front / alpha_back)²', () => {
    // Front disc much smaller than back; collinear → front fully on
    // top of back. Occluded area = π·alpha_front²; dim factor on back
    // is 1 − alpha_front² / alpha_back².
    const cam = { x: 0, y: 0, z: 0 };
    const primary = { x: 0, y: 0, z: 10 }; // back (bigger angular)
    const secondary = { x: 0, y: 0, z: 5 }; // front (smaller angular)
    const rPriPc = 0.1;   // alpha_pri = 0.01
    const rSecPc = 0.001; // alpha_sec = 2e-4
    const r = eclipseDim({
      primary, secondary, camera: cam,
      radiusPrimaryPc: rPriPc, radiusSecondaryPc: rSecPc,
    });
    expect(r.front).toBe('secondary');
    const alphaFront = rSecPc / 5;
    const alphaBack = rPriPc / 10;
    const expected = 1 - (alphaFront * alphaFront) / (alphaBack * alphaBack);
    expect(r.dim).toBeCloseTo(expected, 6);
  });

  it('equal radii grazing transit: 0 < dim < 1', () => {
    // Same angular radii; perpendicular separation halfway between 0
    // and (alpha_pri + alpha_sec) → partial overlap, dim somewhere in
    // the middle.
    const cam = { x: 0, y: 0, z: 0 };
    const dPri = 5;
    const dSec = 10;
    const rPc = 0.05;
    const alphaPri = rPc / dPri;
    const alphaSec = rPc / dSec;
    const theta = 0.6 * (alphaPri + alphaSec);
    const primary = { x: 0, y: 0, z: dPri };
    // Place secondary offset by theta·d_sec in x, behind the primary.
    const secondary = { x: theta * dSec, y: 0, z: dSec };
    const r = eclipseDim({
      primary, secondary, camera: cam,
      radiusPrimaryPc: rPc, radiusSecondaryPc: rPc,
    });
    expect(r.front).toBe('primary');
    expect(r.dim).toBeGreaterThan(0);
    expect(r.dim).toBeLessThan(1);
  });
});

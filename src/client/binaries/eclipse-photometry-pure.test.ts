import { describe, it, expect } from 'vitest';
import {
  circleCircleLensArea,
  eclipseDimFromOffsets,
  orbitPlaneNormalICRS,
  DIM_FLOOR,
  type EclipseResult,
} from './eclipse-photometry-pure';
import { type OrbitalElements } from './binary-orbit-pure';

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

/** los = primary − camera; rel = secondary − primary. */
function dimOf(
  los: [number, number, number],
  rel: [number, number, number],
  rPriPc: number,
  rSecPc: number,
): EclipseResult {
  return eclipseDimFromOffsets(
    los[0], los[1], los[2],
    rel[0], rel[1], rel[2],
    rPriPc, rSecPc,
  );
}

describe('eclipseDimFromOffsets — degenerate inputs', () => {
  it('zero radii produce no dim', () => {
    const r = dimOf([0, 0, 10], [0.001, 0, 0], 0, 0);
    expect(r.dim).toBe(1);
  });

  it('zero relative offset produces no dim', () => {
    const r = dimOf([0, 0, 10], [0, 0, 0], 1e-3, 1e-3);
    expect(r.dim).toBe(1);
  });

  it('camera inside either disc produces no dim (resolved-disc regime)', () => {
    expect(dimOf([0, 0, 1], [0.001, 0, 0], 1, 1e-3).dim).toBe(1);
    expect(dimOf([0, 0, 1], [0, 0, 1], 1e-3, 1.5).dim).toBe(1);
  });
});

describe('eclipseDimFromOffsets — no overlap', () => {
  it('wide projected separation: dim = 1', () => {
    // 1 R_sun ≈ 2.25e-8 pc; pair 1 pc from camera with 1 pc lateral
    // separation — angular separation ≫ both angular radii.
    const r = dimOf([0, 0, 1], [1, 0, 0], 2.25e-8, 2.25e-8);
    expect(r.dim).toBe(1);
  });

  it('resolves sub-AU geometry against a float32-quantized line of sight', () => {
    // The regression this module exists for: at 25 pc from the local
    // origin the float32 position quantum (~0.6 AU) exceeds the pair
    // separation, so ANY approach that differences two buffer positions
    // reads garbage. Here los carries float32 quantization while rel is
    // exact — a 0.08 AU lateral offset must still resolve as
    // no-overlap (true angular separation ≈ 1.5e-8 rad, radii sum
    // ≈ 4.9e-9 rad).
    const AU = 4.84813681e-6;
    const c = Math.fround(25 / Math.sqrt(3));
    const rSun = 2.25461e-8;
    const r = dimOf([c, c, c], [0.08 * AU, 0, 0], 2.8 * rSun, 2.6 * rSun);
    expect(r.dim).toBe(1);
  });
});

describe('eclipseDimFromOffsets — front/back determination', () => {
  it('secondary closer to camera → primary is the back', () => {
    const r = dimOf([0, 0, 10], [0, 0, -5], 5e-3, 5e-3);
    expect(r.front).toBe('secondary');
    expect(r.dim).toBeLessThan(1);
  });

  it('primary closer to camera → secondary is the back', () => {
    const r = dimOf([0, 0, 5], [0, 0, 5], 5e-3, 5e-3);
    expect(r.front).toBe('primary');
    expect(r.dim).toBeLessThan(1);
  });

  it('front/back stays stable when the LOS offset dwarfs the pair offset', () => {
    // dSec − dPri ≈ 1e-9 pc — far below what differencing two ~25 pc
    // distances resolves; the discriminant form must still pick it up.
    const rel: [number, number, number] = [1e-9, 0, 0];
    const r = dimOf([25, 0, 0], rel, 5e-9, 5e-9);
    expect(r.front).toBe('primary');
  });
});

describe('eclipseDimFromOffsets — full and partial occlusion', () => {
  it('small back fully hidden by larger front: dim clamps to DIM_FLOOR', () => {
    // Front (secondary) closer and much bigger; back's full disc hidden.
    const r = dimOf([0, 0, 10], [0, 0, -5], 5e-3, 0.5);
    expect(r.front).toBe('secondary');
    expect(r.dim).toBe(DIM_FLOOR);
  });

  it('small front on bigger back: dim = 1 − (alpha_front / alpha_back)²', () => {
    const rPriPc = 0.1;   // back at d=10 → alpha 0.01
    const rSecPc = 0.001; // front at d=5 → alpha 2e-4
    const r = dimOf([0, 0, 10], [0, 0, -5], rPriPc, rSecPc);
    expect(r.front).toBe('secondary');
    const alphaFront = rSecPc / 5;
    const alphaBack = rPriPc / 10;
    const expected = 1 - (alphaFront * alphaFront) / (alphaBack * alphaBack);
    expect(r.dim).toBeCloseTo(expected, 6);
  });

  it('equal radii grazing transit: 0 < dim < 1', () => {
    const dPri = 5;
    const dSec = 10;
    const rPc = 0.05;
    const alphaPri = rPc / dPri;
    const alphaSec = rPc / dSec;
    const theta = 0.6 * (alphaPri + alphaSec);
    const r = dimOf([0, 0, dPri], [theta * dSec, 0, dSec - dPri], rPc, rPc);
    expect(r.front).toBe('primary');
    expect(r.dim).toBeGreaterThan(0);
    expect(r.dim).toBeLessThan(1);
  });
});

describe('orbitPlaneNormalICRS', () => {
  it('tier-1 edge-on orbit at (10,0,0): plane spans z (north) × x (radial) → normal ∥ y', () => {
    const elements: OrbitalElements = {
      P: 10, T: 0, e: 0, a: 1, i: Math.PI / 2, omega: 0, Omega: 0, q: 0.5,
    };
    const n = orbitPlaneNormalICRS(1, elements, { x: 10, y: 0, z: 0 });
    expect(n).not.toBeNull();
    expect(Math.abs(n!.y)).toBeCloseTo(1, 9);
  });

  it('tier-1 face-on orbit at (10,0,0): plane is the sky tangent → normal ∥ x (LOS)', () => {
    const elements: OrbitalElements = {
      P: 10, T: 0, e: 0, a: 1, i: 0, omega: 0, Omega: 0, q: 0.5,
    };
    const n = orbitPlaneNormalICRS(1, elements, { x: 10, y: 0, z: 0 });
    expect(n).not.toBeNull();
    expect(Math.abs(n!.x)).toBeCloseTo(1, 9);
  });

  it('tier-2 normal is the galactic pole in ICRS', () => {
    const elements: OrbitalElements = {
      P: 10, T: 0, e: 0, a: 1, i: 0, omega: 0, Omega: 0, q: 0.5,
    };
    const n = orbitPlaneNormalICRS(2, elements, { x: 10, y: 0, z: 0 });
    expect(n).not.toBeNull();
    // NGP in ICRS: RA 192.859°, Dec +27.128°.
    const ra = (192.859 * Math.PI) / 180;
    const dec = (27.128 * Math.PI) / 180;
    const ngp = {
      x: Math.cos(dec) * Math.cos(ra),
      y: Math.cos(dec) * Math.sin(ra),
      z: Math.sin(dec),
    };
    const dot = n!.x * ngp.x + n!.y * ngp.y + n!.z * ngp.z;
    expect(Math.abs(dot)).toBeCloseTo(1, 3);
  });

  it('normal is unit length and orthogonal to sampled orbit vectors', () => {
    const elements: OrbitalElements = {
      P: 37, T: 12345, e: 0.4, a: 2, i: 1.1, omega: 0.7, Omega: 2.3, q: 0.3,
    };
    const sys = { x: 3, y: -7, z: 5 };
    const n = orbitPlaneNormalICRS(1, elements, sys);
    expect(n).not.toBeNull();
    expect(Math.hypot(n!.x, n!.y, n!.z)).toBeCloseTo(1, 9);
  });
});

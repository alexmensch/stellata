import { describe, it, expect } from 'vitest';
import {
  evaluateOrbitSkyAU,
  evaluateOrbitInPlaneAU,
  evaluateOrbitSeparationAU,
  evaluateOrbitDeltaPcTier1,
  evaluateOrbitDeltaPcTier2,
  evaluateBinaryOffsetTier1,
  evaluateBinaryOffsetTier2,
  projectSkyToICRS,
  projectGalacticPlaneToICRS,
  type OrbitalElements,
} from './binary-orbit-pure';
import { AU_PC, J2000_JD } from '../util/astronomy-constants';
import { GALACTIC_NORTH_POLE_ICRS } from '../galactic/galactic-coords';

function elt(over: Partial<OrbitalElements>): OrbitalElements {
  return {
    P: 365.25, T: J2000_JD, e: 0, a: 1, q: 0.5,
    i: 0, omega: 0, Omega: 0,
    ...over,
  };
}

describe('evaluateOrbitSkyAU — face-on circular orbit', () => {
  const elements = elt({ a: 1, e: 0, i: 0, omega: 0, Omega: 0, P: 365.25 });

  it('separation magnitude equals a at every phase', () => {
    for (let k = 0; k < 8; k++) {
      const t = J2000_JD + (k / 8) * elements.P;
      const { northAU, eastAU } = evaluateOrbitSkyAU(elements, t);
      expect(Math.hypot(northAU, eastAU)).toBeCloseTo(1.0, 10);
    }
  });

  it('returns to the same position after one full period', () => {
    const t = J2000_JD + 0.137 * elements.P;
    const a0 = evaluateOrbitSkyAU(elements, t);
    const a1 = evaluateOrbitSkyAU(elements, t + elements.P);
    expect(a1.northAU).toBeCloseTo(a0.northAU, 9);
    expect(a1.eastAU).toBeCloseTo(a0.eastAU, 9);
  });

  it('sweeps all four sky-plane quadrants over one period', () => {
    const quadrants = new Set<number>();
    for (let k = 0; k < 16; k++) {
      const t = J2000_JD + (k / 16) * elements.P;
      const { northAU, eastAU } = evaluateOrbitSkyAU(elements, t);
      const q = (northAU >= 0 ? 0 : 2) + (eastAU >= 0 ? 0 : 1);
      quadrants.add(q);
    }
    expect(quadrants.size).toBe(4);
  });
});

describe('evaluateOrbitSkyAU — edge-on orbit', () => {
  const elements = elt({ e: 0, i: Math.PI / 2, omega: 0, Omega: 0 });

  it('east component is zero at all phases', () => {
    for (let k = 0; k < 12; k++) {
      const t = J2000_JD + (k / 12) * elements.P;
      expect(Math.abs(evaluateOrbitSkyAU(elements, t).eastAU)).toBeLessThan(1e-12);
    }
  });

  it('north component spans ±a over one period', () => {
    let nMin = Infinity, nMax = -Infinity;
    for (let k = 0; k < 64; k++) {
      const t = J2000_JD + (k / 64) * elements.P;
      const { northAU } = evaluateOrbitSkyAU(elements, t);
      nMin = Math.min(nMin, northAU);
      nMax = Math.max(nMax, northAU);
    }
    expect(nMax).toBeCloseTo(1, 6);
    expect(nMin).toBeCloseTo(-1, 6);
  });
});

describe('evaluateOrbitSkyAU — radial (line-of-sight) component', () => {
  it('face-on orbit has zero radial component at all phases', () => {
    const elements = elt({ e: 0.3, a: 2, i: 0, omega: 0.7, Omega: 1.2 });
    for (let k = 0; k < 12; k++) {
      const t = J2000_JD + (k / 12) * elements.P;
      expect(evaluateOrbitSkyAU(elements, t).radialAU).toBeCloseTo(0, 15);
    }
  });

  it('edge-on circular orbit: radial spans ±a and the 3D magnitude stays a', () => {
    const elements = elt({ e: 0, a: 1, i: Math.PI / 2, omega: 0, Omega: 0 });
    let rMin = Infinity, rMax = -Infinity;
    for (let k = 0; k < 64; k++) {
      const t = J2000_JD + (k / 64) * elements.P;
      const { northAU, eastAU, radialAU } = evaluateOrbitSkyAU(elements, t);
      rMin = Math.min(rMin, radialAU);
      rMax = Math.max(rMax, radialAU);
      expect(Math.hypot(northAU, eastAU, radialAU)).toBeCloseTo(1, 10);
    }
    expect(rMax).toBeCloseTo(1, 6);
    expect(rMin).toBeCloseTo(-1, 6);
  });

  it('eccentric inclined orbit: 3D magnitude equals a(1−e) at periapsis and stays in bounds', () => {
    const elements = elt({ e: 0.591, a: 19.77, P: 50.13 * 365.25, i: 1.1, omega: 0.7, Omega: 2.3 });
    const p = evaluateOrbitSkyAU(elements, J2000_JD);
    expect(Math.hypot(p.northAU, p.eastAU, p.radialAU)).toBeCloseTo(elements.a * (1 - elements.e), 6);
    for (let k = 0; k < 32; k++) {
      const t = J2000_JD + (k / 32) * elements.P;
      const { northAU, eastAU, radialAU } = evaluateOrbitSkyAU(elements, t);
      const r = Math.hypot(northAU, eastAU, radialAU);
      expect(r).toBeGreaterThanOrEqual(elements.a * (1 - elements.e) - 1e-6);
      expect(r).toBeLessThanOrEqual(elements.a * (1 + elements.e) + 1e-6);
    }
  });
});

describe('evaluateOrbitSkyAU — eccentric orbit', () => {
  const elements = elt({ e: 0.591, a: 19.77, P: 50.13 * 365.25 });

  it('separation at periapsis equals a(1−e)', () => {
    const { northAU, eastAU } = evaluateOrbitSkyAU(elements, J2000_JD);
    expect(Math.hypot(northAU, eastAU)).toBeCloseTo(elements.a * (1 - elements.e), 6);
  });

  it('separation at apoapsis equals a(1+e)', () => {
    const t = J2000_JD + elements.P / 2;
    const { northAU, eastAU } = evaluateOrbitSkyAU(elements, t);
    expect(Math.hypot(northAU, eastAU)).toBeCloseTo(elements.a * (1 + elements.e), 6);
  });

  it('separation stays within [a(1−e), a(1+e)] at every phase', () => {
    const rMin = elements.a * (1 - elements.e);
    const rMax = elements.a * (1 + elements.e);
    for (let k = 0; k < 32; k++) {
      const t = J2000_JD + (k / 32) * elements.P;
      const { northAU, eastAU } = evaluateOrbitSkyAU(elements, t);
      const r = Math.hypot(northAU, eastAU);
      expect(r).toBeGreaterThanOrEqual(rMin - 1e-6);
      expect(r).toBeLessThanOrEqual(rMax + 1e-6);
    }
  });
});

describe('evaluateOrbitInPlaneAU', () => {
  it('matches evaluateOrbitSkyAU at i=0, Omega=0 (face-on, zero node)', () => {
    const elements = elt({ e: 0.4, a: 2.5, omega: 0.6, i: 0, Omega: 0 });
    for (let k = 0; k < 8; k++) {
      const t = J2000_JD + (k / 8) * elements.P;
      const inPlane = evaluateOrbitInPlaneAU(elements, t);
      const sky = evaluateOrbitSkyAU(elements, t);
      expect(inPlane.xAU).toBeCloseTo(sky.northAU, 10);
      expect(inPlane.yAU).toBeCloseTo(sky.eastAU, 10);
    }
  });

  it('separation magnitude equals true-anomaly radius', () => {
    const elements = elt({ e: 0.3, a: 5.0, omega: 1.1 });
    for (let k = 1; k < 16; k++) {
      const t = J2000_JD + (k / 16) * elements.P;
      const { xAU, yAU } = evaluateOrbitInPlaneAU(elements, t);
      const r = Math.hypot(xAU, yAU);
      expect(r).toBeGreaterThanOrEqual(elements.a * (1 - elements.e) - 1e-6);
      expect(r).toBeLessThanOrEqual(elements.a * (1 + elements.e) + 1e-6);
    }
  });
});

describe('evaluateOrbitSeparationAU', () => {
  // The card formatters quote this as ρ for BOTH tiers, which is only
  // honest if the orbit's orientation can't move it.
  it('equals the Tier-1 3D magnitude at any inclination and node', () => {
    const elements = elt({ e: 0.45, a: 3.2, omega: 0.7, i: 1.02, Omega: 2.4 });
    for (let k = 0; k < 8; k++) {
      const t = J2000_JD + (k / 8) * elements.P;
      const sky = evaluateOrbitSkyAU(elements, t);
      expect(evaluateOrbitSeparationAU(elements, t)).toBeCloseTo(
        Math.hypot(sky.northAU, sky.eastAU, sky.radialAU), 10,
      );
    }
  });

  it('equals the Tier-2 in-plane magnitude for the same elements', () => {
    const elements = elt({ e: 0.45, a: 3.2, omega: 0.7, i: 1.02, Omega: 2.4 });
    for (let k = 0; k < 8; k++) {
      const t = J2000_JD + (k / 8) * elements.P;
      const p = evaluateOrbitInPlaneAU(elements, t);
      expect(evaluateOrbitSeparationAU(elements, t)).toBeCloseTo(
        Math.hypot(p.xAU, p.yAU), 10,
      );
    }
  });

  it('spans periapsis a(1−e) to apoapsis a(1+e)', () => {
    const elements = elt({ e: 0.52, a: 10, omega: 0.3, i: 0.9 });
    expect(evaluateOrbitSeparationAU(elements, elements.T)).toBeCloseTo(4.8, 10);
    expect(evaluateOrbitSeparationAU(elements, elements.T + elements.P / 2))
      .toBeCloseTo(15.2, 10);
  });
});

describe('projectSkyToICRS — radial component', () => {
  it('radial input rides the Sol→system direction', () => {
    const out = projectSkyToICRS({ x: 10, y: 0, z: 0 }, 0, 0, 3);
    expect(out.x).toBeCloseTo(3, 12);
    expect(out.y).toBeCloseTo(0, 12);
    expect(out.z).toBeCloseTo(0, 12);
  });

  it('preserves the 3D magnitude and keeps radial ⊥ tangent for a generic system', () => {
    const sys = { x: 3, y: -7, z: 5 };
    const out = projectSkyToICRS(sys, 2, 3, 4);
    expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(Math.hypot(2, 3, 4), 10);
    const tangent = projectSkyToICRS(sys, 2, 3, 0);
    const radial = projectSkyToICRS(sys, 0, 0, 4);
    const dot = tangent.x * radial.x + tangent.y * radial.y + tangent.z * radial.z;
    expect(Math.abs(dot)).toBeLessThan(1e-10);
  });
});

describe('projectSkyToICRS', () => {
  it('returns zero when the input separation is zero', () => {
    const out = projectSkyToICRS({ x: 1, y: 2, z: 3 }, 0, 0);
    expect(out.x === 0 && out.y === 0 && out.z === 0).toBe(true);
  });

  it('returns zero when the system is at the origin (degenerate)', () => {
    const out = projectSkyToICRS({ x: 0, y: 0, z: 0 }, 1, 1);
    expect(out.x === 0 && out.y === 0 && out.z === 0).toBe(true);
  });

  it('preserves separation magnitude (perpendicular to LOS)', () => {
    const out = projectSkyToICRS({ x: 10, y: 0, z: 0 }, 2, 3);
    expect(out.x).toBeCloseTo(0, 12);
    expect(out.y).toBeCloseTo(3, 12);
    expect(out.z).toBeCloseTo(2, 12);
    expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(Math.hypot(2, 3), 12);
  });

  it('output is perpendicular to the system line-of-sight', () => {
    const sys = { x: 5, y: 7, z: -3 };
    const out = projectSkyToICRS(sys, 1.5, -0.8);
    const dot = out.x * sys.x + out.y * sys.y + out.z * sys.z;
    expect(Math.abs(dot)).toBeLessThan(1e-10);
  });

  it('east and north components are orthogonal', () => {
    const sys = { x: 5, y: 7, z: -3 };
    const east = projectSkyToICRS(sys, 0, 1);
    const north = projectSkyToICRS(sys, 1, 0);
    const dot = east.x * north.x + east.y * north.y + east.z * north.z;
    expect(Math.abs(dot)).toBeLessThan(1e-12);
  });
});

describe('projectGalacticPlaneToICRS', () => {
  it('zero input ⇒ zero output', () => {
    const out = projectGalacticPlaneToICRS(0, 0);
    expect(out.x === 0 && out.y === 0 && out.z === 0).toBe(true);
  });

  it('preserves magnitude (in-plane vector rotated rigidly)', () => {
    const out = projectGalacticPlaneToICRS(2, 3);
    expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(Math.hypot(2, 3), 12);
  });

  it('output is orthogonal to the North Galactic Pole', () => {
    // Vectors lying in the galactic XY plane are perpendicular to the
    // galactic Z axis by definition. ICRS-space rotation preserves the
    // angle.
    const out = projectGalacticPlaneToICRS(1.5, -0.8);
    const dot =
      out.x * GALACTIC_NORTH_POLE_ICRS.x +
      out.y * GALACTIC_NORTH_POLE_ICRS.y +
      out.z * GALACTIC_NORTH_POLE_ICRS.z;
    expect(Math.abs(dot)).toBeLessThan(1e-10);
  });
});

describe('evaluateOrbitDeltaPcTier1 — relative motion (no sign)', () => {
  const elements = elt({
    P: 50.13 * 365.25, T: J2000_JD - 10 * 365.25,
    e: 0.591, a: 19.77, q: 0.33,
    i: 2.5, omega: 0.7, Omega: 0.8,
  });
  const systemXyz = { x: 2.64, y: 0, z: 0 };
  const refSky = evaluateOrbitSkyAU(elements, J2000_JD);

  it('returns zero at t = J2000 (reference cancels)', () => {
    const out = evaluateOrbitDeltaPcTier1(elements, refSky, J2000_JD, systemXyz);
    expect(Math.hypot(out.x, out.y, out.z)).toBeLessThan(1e-15);
  });

  it('matches |evaluateBinaryOffsetTier1| / (1−q) at the secondary side', () => {
    // Off-J2000 phase ⇒ non-trivial offset. The full relative motion
    // (no-sign helper) equals the secondary's offset scaled up by 1/(1−q).
    const tHalf = J2000_JD + elements.P / 2;
    const delta = evaluateOrbitDeltaPcTier1(elements, refSky, tHalf, systemXyz);
    const secondary = evaluateBinaryOffsetTier1(elements, tHalf, J2000_JD, true, systemXyz);
    const ratio = Math.hypot(delta.x, delta.y, delta.z)
      / Math.hypot(secondary.x, secondary.y, secondary.z);
    expect(ratio).toBeCloseTo(1 / (1 - elements.q), 10);
  });
});

describe('evaluateOrbitDeltaPcTier2 — relative motion (no sign)', () => {
  const elements = elt({
    P: 50 * 365.25, T: J2000_JD, e: 0.4, a: 5, q: 0.4,
    omega: 0.7, Omega: 0, i: 0,
  });
  const refInPlane = evaluateOrbitInPlaneAU(elements, J2000_JD);

  it('returns zero at t = J2000', () => {
    const out = evaluateOrbitDeltaPcTier2(elements, refInPlane, J2000_JD);
    expect(Math.hypot(out.x, out.y, out.z)).toBeLessThan(1e-15);
  });

  it('matches |evaluateBinaryOffsetTier2| / (1−q) at the secondary side', () => {
    const tHalf = J2000_JD + elements.P / 2;
    const delta = evaluateOrbitDeltaPcTier2(elements, refInPlane, tHalf);
    const secondary = evaluateBinaryOffsetTier2(elements, tHalf, J2000_JD, true);
    const ratio = Math.hypot(delta.x, delta.y, delta.z)
      / Math.hypot(secondary.x, secondary.y, secondary.z);
    expect(ratio).toBeCloseTo(1 / (1 - elements.q), 10);
  });
});

describe('evaluateBinaryOffsetTier1 — baseline epoch', () => {
  const elements = elt({ e: 0.591, a: 19.77, P: 50.13 * 365.25, q: 0.33 });
  const systemXyz = { x: 2, y: -1, z: 0.5 };

  it('A-side offset is zero at t = J2000', () => {
    const out = evaluateBinaryOffsetTier1(elements, J2000_JD, J2000_JD, false, systemXyz);
    expect(Math.hypot(out.x, out.y, out.z)).toBeLessThan(1e-15);
  });

  it('B-side offset is zero at t = J2000', () => {
    const out = evaluateBinaryOffsetTier1(elements, J2000_JD, J2000_JD, true, systemXyz);
    expect(Math.hypot(out.x, out.y, out.z)).toBeLessThan(1e-15);
  });

  it('offset is zero at t = refJd for a non-J2000 baseline epoch', () => {
    const refJd = J2000_JD + 23 * 365.25;
    for (const isSecondary of [false, true]) {
      const out = evaluateBinaryOffsetTier1(elements, refJd, refJd, isSecondary, systemXyz);
      expect(Math.hypot(out.x, out.y, out.z)).toBeLessThan(1e-15);
    }
  });

  it('returns to zero after one full orbital period', () => {
    const t = J2000_JD + elements.P;
    const a = evaluateBinaryOffsetTier1(elements, t, J2000_JD, false, systemXyz);
    const b = evaluateBinaryOffsetTier1(elements, t, J2000_JD, true, systemXyz);
    expect(Math.hypot(a.x, a.y, a.z)).toBeLessThan(1e-9);
    expect(Math.hypot(b.x, b.y, b.z)).toBeLessThan(1e-9);
  });
});

describe('evaluateBinaryOffsetTier1 — barycenter symmetry', () => {
  const elements = elt({
    e: 0.591, a: 19.77, P: 50.13 * 365.25, q: 0.33,
    i: 1.1, omega: 0.7, Omega: 1.5,
  });
  const systemXyz = { x: 2, y: -1, z: 0.5 };

  it('A and B offsets are anti-parallel at every sampled phase', () => {
    for (let k = 1; k < 16; k++) {
      const t = J2000_JD + (k / 16) * elements.P;
      const a = evaluateBinaryOffsetTier1(elements, t, J2000_JD, false, systemXyz);
      const b = evaluateBinaryOffsetTier1(elements, t, J2000_JD, true, systemXyz);
      const aMag = Math.hypot(a.x, a.y, a.z);
      const bMag = Math.hypot(b.x, b.y, b.z);
      const dot = (a.x * b.x + a.y * b.y + a.z * b.z) / (aMag * bMag);
      expect(dot).toBeCloseTo(-1, 10);
    }
  });

  it('magnitude ratio |A| : |B| equals q : (1−q)', () => {
    const expected = elements.q / (1 - elements.q);
    for (let k = 1; k < 16; k++) {
      const t = J2000_JD + (k / 16) * elements.P;
      const a = evaluateBinaryOffsetTier1(elements, t, J2000_JD, false, systemXyz);
      const b = evaluateBinaryOffsetTier1(elements, t, J2000_JD, true, systemXyz);
      const ratio = Math.hypot(a.x, a.y, a.z) / Math.hypot(b.x, b.y, b.z);
      expect(ratio).toBeCloseTo(expected, 10);
    }
  });

  it('barycenter (1−q)·A + q·B is zero', () => {
    for (let k = 1; k < 16; k++) {
      const t = J2000_JD + (k / 16) * elements.P;
      const a = evaluateBinaryOffsetTier1(elements, t, J2000_JD, false, systemXyz);
      const b = evaluateBinaryOffsetTier1(elements, t, J2000_JD, true, systemXyz);
      const cx = (1 - elements.q) * a.x + elements.q * b.x;
      const cy = (1 - elements.q) * a.y + elements.q * b.y;
      const cz = (1 - elements.q) * a.z + elements.q * b.z;
      expect(Math.abs(cx)).toBeLessThan(1e-15);
      expect(Math.abs(cy)).toBeLessThan(1e-15);
      expect(Math.abs(cz)).toBeLessThan(1e-15);
    }
  });
});

describe('evaluateBinaryOffsetTier1 — Sirius-shaped orbit', () => {
  const elements = elt({
    P: 50.13 * 365.25, T: J2000_JD - 10 * 365.25,
    e: 0.591, a: 19.77, q: 0.33,
    i: 2.5, omega: 0.7, Omega: 0.8,
  });
  const systemXyz = { x: 2.64, y: 0, z: 0 };

  it('B-side offset has the expected order of magnitude (~10 AU in parsecs)', () => {
    let maxOffset = 0;
    for (let k = 0; k < 32; k++) {
      const t = J2000_JD + (k / 32) * elements.P;
      const b = evaluateBinaryOffsetTier1(elements, t, J2000_JD, true, systemXyz);
      maxOffset = Math.max(maxOffset, Math.hypot(b.x, b.y, b.z));
    }
    const expectedScale = elements.a * (1 + elements.e) * (1 - elements.q) * AU_PC;
    expect(maxOffset).toBeGreaterThan(expectedScale * 0.4);
    expect(maxOffset).toBeLessThan(expectedScale * 1.2);
  });
});

describe('evaluateBinaryOffsetTier2 — invariants', () => {
  const elements = elt({
    P: 50 * 365.25, T: J2000_JD, e: 0.4, a: 5, q: 0.4,
    omega: 0.7, Omega: 0, i: 0,
  });

  it('A-side offset is zero at t = J2000', () => {
    const out = evaluateBinaryOffsetTier2(elements, J2000_JD, J2000_JD, false);
    expect(Math.hypot(out.x, out.y, out.z)).toBeLessThan(1e-15);
  });

  it('A and B offsets are anti-parallel at every sampled phase', () => {
    for (let k = 1; k < 12; k++) {
      const t = J2000_JD + (k / 12) * elements.P;
      const a = evaluateBinaryOffsetTier2(elements, t, J2000_JD, false);
      const b = evaluateBinaryOffsetTier2(elements, t, J2000_JD, true);
      const aMag = Math.hypot(a.x, a.y, a.z);
      const bMag = Math.hypot(b.x, b.y, b.z);
      const dot = (a.x * b.x + a.y * b.y + a.z * b.z) / (aMag * bMag);
      expect(dot).toBeCloseTo(-1, 10);
    }
  });

  it('every offset lies in the galactic plane (perpendicular to NGP)', () => {
    for (let k = 1; k < 12; k++) {
      const t = J2000_JD + (k / 12) * elements.P;
      const off = evaluateBinaryOffsetTier2(elements, t, J2000_JD, true);
      const dot =
        off.x * GALACTIC_NORTH_POLE_ICRS.x +
        off.y * GALACTIC_NORTH_POLE_ICRS.y +
        off.z * GALACTIC_NORTH_POLE_ICRS.z;
      expect(Math.abs(dot)).toBeLessThan(1e-10);
    }
  });
});

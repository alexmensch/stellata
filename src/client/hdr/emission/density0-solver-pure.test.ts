import { describe, expect, it } from 'vitest';
import {
  fluxNumber,
  integrateOverEllipsoid,
  solveDensity0,
} from './density0-solver-pure';

describe('integrateOverEllipsoid', () => {
  it('recovers the ellipsoid volume for f = 1', () => {
    const v = integrateOverEllipsoid(() => 1, [3, 4, 5]);
    expect(v).toBeCloseTo((4 / 3) * Math.PI * 3 * 4 * 5, 6);
  });

  // The unit-ball frame's cosθ is measured from the C axis, so a profile
  // separable in (R, |z|) has to reach the physical coordinates through the
  // caller's own semi-axes. Integrating exp(−|z|/z_d) over a sphere against
  // its closed form catches an axis swap, which the volume check above
  // cannot see.
  it('integrates a z-separable profile against its closed form', () => {
    const rEnv = 400;
    const zd = 90;
    const numeric = integrateOverEllipsoid(
      (r, c) => Math.exp(-Math.abs(rEnv * r * c) / zd),
      [rEnv, rEnv, rEnv],
    );
    let reference = 0;
    const nz = 20_000;
    for (let i = 0; i < nz; i++) {
      const z = ((i + 0.5) / nz) * rEnv;
      reference +=
        Math.PI * (rEnv * rEnv - z * z) * Math.exp(-z / zd) * (rEnv / nz);
    }
    expect(Math.abs(numeric - 2 * reference) / numeric).toBeLessThan(1e-8);
  });
});

describe('solveDensity0', () => {
  it('round-trips the far-field flux: ρ₀·G / d² = 10^(−0.4·mV)', () => {
    const g = integrateOverEllipsoid(() => 1, [500, 400, 400]);
    const d = 100_000;
    const rho0 = solveDensity0(d, fluxNumber(7.5), g);
    expect((rho0 * g) / (d * d)).toBeCloseTo(fluxNumber(7.5), 12);
  });

  // The absolute-magnitude form both volumetric layers use: a source whose
  // ρ₀ is solved at 10 pc against 10^(−0.4·M) integrates to that absolute
  // magnitude, so an emitter can be anchored on a published M_V with no
  // intermediate distance.
  it('anchors on an absolute magnitude at the 10 pc definition distance', () => {
    const g = integrateOverEllipsoid(() => 1, [3000, 3000, 400]);
    const rho0 = solveDensity0(10, fluxNumber(-21.37), g);
    expect(-2.5 * Math.log10((rho0 * g) / 100)).toBeCloseTo(-21.37, 12);
  });
});

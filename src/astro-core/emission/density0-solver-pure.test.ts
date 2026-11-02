import { describe, expect, it } from 'vitest';
import {
  fluxNumber,
  integrateOverEllipsoid,
  integrateOverEllipsoidRz,
  solveDensity0,
} from './density0-solver-pure';

describe('integrateOverEllipsoid', () => {
  it('recovers the ellipsoid volume for f = 1', () => {
    const v = integrateOverEllipsoid(() => 1, [3, 4, 5]);
    expect(v).toBeCloseTo((4 / 3) * Math.PI * 3 * 4 * 5, 6);
  });

});

describe('integrateOverEllipsoidRz', () => {
  it('recovers the spheroid volume for f = 1', () => {
    const v = integrateOverEllipsoidRz(() => 1, 4, 5);
    expect(v).toBeCloseTo((4 / 3) * Math.PI * 4 * 4 * 5, 6);
  });

  // The unit-ball frame's cosθ is measured from the C axis, so the mapping
  // to physical (R, |z|) is where an axis swap would hide — invisible to
  // the volume check above, which is symmetric in the two. Integrating
  // exp(−|z|/z_d) over a sphere against its closed form catches it.
  it('integrates a z-separable profile against its closed form', () => {
    const rEnv = 400;
    const zd = 90;
    const numeric = integrateOverEllipsoidRz(
      (_R, z) => Math.exp(-z / zd),
      rEnv,
      rEnv,
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

  // The R-separable mirror of the check above. Both are needed: on a sphere
  // the two semi-axes are equal, so either one alone passes under a swap.
  //
  // It also states the quadrature's WORSE direction. R reaches the profile
  // through √(1 − cos²θ), which has infinite slope at the pole, so the
  // polar Gauss–Legendre rule converges on a radial profile far more slowly
  // than on a vertical one, and runs low: −3.4e-5 against 1e-8. That is the
  // accuracy the disc's own G carries (4e-5 mag), pinned rather than bounded
  // so raising the node counts shows up here as a change.
  it('integrates an R-separable profile against its closed form', () => {
    const rEnv = 400;
    const rd = 90;
    const numeric = integrateOverEllipsoidRz((R) => Math.exp(-R / rd), rEnv, rEnv);
    // R = rEnv·sinφ, so the reference integrand is smooth — a midpoint rule
    // over R itself inherits the same rim singularity it is checking.
    let reference = 0;
    const nPhi = 20_000;
    for (let i = 0; i < nPhi; i++) {
      const phi = (((i + 0.5) / nPhi) * Math.PI) / 2;
      reference +=
        4 * Math.PI * rEnv ** 3 * Math.sin(phi) * Math.cos(phi) ** 2 *
        Math.exp((-rEnv * Math.sin(phi)) / rd) * (Math.PI / 2 / nPhi);
    }
    const relErr = (numeric - reference) / reference;
    expect(relErr * 1e5).toBeCloseTo(-3.417, 3);
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

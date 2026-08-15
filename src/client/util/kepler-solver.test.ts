import { describe, it, expect } from 'vitest';
import {
  cartesianToOrbitalElements,
  orbitalStateToCartesian,
  solveKepler,
} from './kepler-solver';
import { wrapAngle } from './angles';

describe('solveKepler — residual', () => {
  // M − E + e·sin(E) must vanish at the solver's tolerance for every
  // eccentricity in the regime the binary catalog spans (e up to ~0.95).
  for (const e of [0, 0.1, 0.3, 0.6, 0.9, 0.95]) {
    it(`residual < 1e-10 at e=${e} across 32 phase samples`, () => {
      for (let k = 0; k < 32; k++) {
        const M = (k / 32) * 2 * Math.PI - Math.PI;
        const E = solveKepler(M, e);
        const residual = E - e * Math.sin(E) - wrapAngle(M);
        expect(Math.abs(residual)).toBeLessThan(1e-10);
      }
    });
  }
});

describe('solveKepler — high-eccentricity near-periastron', () => {
  // Newton from E₀ = M + e·sinM is weakest at high e near periastron
  // (M → 0 / 2π), where f′(E) = 1 − e·cosE → 1 − e. Empirically ≤ 9
  // iterations at e = 0.99; this sweep pins convergence so a solver
  // change (or an ORB6 orbit above the current e ≈ 0.95 population
  // ceiling) can't silently oscillate past maxIter and return garbage.
  const nearPeriastron = [1e-6, 1e-4, 1e-3, 1e-2, 0.05, -1e-6, -1e-3, -1e-2];
  for (const e of [0.9, 0.95, 0.99]) {
    it(`residual < 1e-10 at e=${e} for M near periastron (0 and 2π)`, () => {
      for (const M0 of nearPeriastron) {
        for (const M of [M0, M0 + 2 * Math.PI]) {
          const E = solveKepler(M, e);
          const residual = E - e * Math.sin(E) - wrapAngle(M);
          expect(Math.abs(residual)).toBeLessThan(1e-10);
        }
      }
    });
  }
});

describe('solveKepler — known fixtures', () => {
  it('circular orbit: E = M', () => {
    for (const M of [-2, -1, 0, 1, 2]) {
      expect(solveKepler(M, 0)).toBeCloseTo(wrapAngle(M), 12);
    }
  });

  it('periodicity: solveKepler(M + 2π) ≡ solveKepler(M)', () => {
    for (const e of [0.1, 0.5, 0.9]) {
      const E1 = solveKepler(0.7, e);
      const E2 = solveKepler(0.7 + 2 * Math.PI, e);
      expect(E2).toBeCloseTo(E1, 12);
    }
  });
});

interface Orbit {
  label: string;
  a: number;
  e: number;
  incRad: number;
  nodeRad: number;
  argPeriRad: number;
  mu: number;
}

const ROUND_TRIP_ORBITS: Orbit[] = [
  // Small e is the sensitive regime for the eccentric anomaly: reading it
  // off a state divides by e, and a leg left unscaled by it distorts the
  // angle as 1/e near E = 0. Don't drop these two rows for being "nearly
  // the circular case" — they are what the low-e legs are checked at.
  {
    label: 'the Moon (e = 0.055, km and km³/s²)',
    a: 384400, e: 0.0549, incRad: 5.16 * (Math.PI / 180),
    nodeRad: 125.08 * (Math.PI / 180), argPeriRad: 318.15 * (Math.PI / 180),
    mu: 403503.2,
  },
  // e stops at 0.01 rather than going lower because ω itself becomes
  // singular as e → 0 — the reason the planet ephemeris carries
  // equinoctial elements (../solar-system/ephemerides/README.md
  // § Equinoctial elements). Below this the assertion would be measuring
  // that singularity, not this function.
  {
    label: 'a near-circular, near-coplanar orbit',
    a: 1, e: 0.01, incRad: 0.004, nodeRad: -2.9, argPeriRad: 1.1, mu: 1,
  },
  {
    label: 'an eccentric, steeply inclined orbit',
    a: 2.5, e: 0.6, incRad: 1.2, nodeRad: 2.7, argPeriRad: -0.4, mu: 3.7,
  },
  {
    label: 'a retrograde orbit',
    a: 0.4, e: 0.21, incRad: 2.74, nodeRad: 0.9, argPeriRad: 2.2, mu: 0.08,
  },
];

// Velocity by central difference in mean anomaly — the same construction
// moonOsculatingOrbit uses, so this exercises the pair as it is consumed.
// dM = 1e-5 leaves ~2e-11 of truncation and keeps ~11 significant digits
// through the difference.
const DM = 1e-5;
const _prev = { x: 0, y: 0, z: 0 };
const _next = { x: 0, y: 0, z: 0 };

function stateAt(o: Orbit, M: number): {
  r: { x: number; y: number; z: number };
  v: { x: number; y: number; z: number };
} {
  const r = { x: 0, y: 0, z: 0 };
  orbitalStateToCartesian(o.a, o.e, o.incRad, o.nodeRad, o.argPeriRad, M, r);
  orbitalStateToCartesian(o.a, o.e, o.incRad, o.nodeRad, o.argPeriRad, M - DM, _prev);
  orbitalStateToCartesian(o.a, o.e, o.incRad, o.nodeRad, o.argPeriRad, M + DM, _next);
  const scale = Math.sqrt(o.mu / (o.a * o.a * o.a)) / (2 * DM);
  return {
    r,
    v: {
      x: (_next.x - _prev.x) * scale,
      y: (_next.y - _prev.y) * scale,
      z: (_next.z - _prev.z) * scale,
    },
  };
}

describe('cartesianToOrbitalElements — inverse of orbitalStateToCartesian', () => {
  for (const o of ROUND_TRIP_ORBITS) {
    it(`recovers every element of ${o.label}`, () => {
      for (let k = 0; k < 16; k++) {
        const M = (k / 16) * 2 * Math.PI;
        const { r, v } = stateAt(o, M);
        const got = cartesianToOrbitalElements(r, v, o.mu);
        const where = `${o.label} at M=${M.toFixed(3)}`;

        expect(got.a / o.a, where).toBeCloseTo(1, 8);
        expect(got.e, where).toBeCloseTo(o.e, 8);
        expect(got.incRad, where).toBeCloseTo(o.incRad, 8);
        expect(wrapAngle(got.nodeRad - o.nodeRad), where).toBeCloseTo(0, 8);
        // ω and E share one noise mode amplified by 1/e, with opposite
        // signs — the state fixes their sum, not each alone — so both are
        // weighted by e. That product is what moves the orbit, and what
        // h/k = e·(sin ϖ, cos ϖ) encode; the unweighted guard is the
        // position round-trip below.
        expect(o.e * wrapAngle(got.argPeriRad - o.argPeriRad), where)
          .toBeCloseTo(0, 8);
        expect(o.e * wrapAngle(got.eccAnomalyRad - solveKepler(M, o.e)), where)
          .toBeCloseTo(0, 8);
      }
    });
  }

  it('places the body back where it started when fed back through the forward map', () => {
    // The round trip the orbit-ring layer actually depends on: elements in,
    // state out, elements back, and the ring vertex at the recovered
    // eccentric anomaly must land ON the body rather than somewhere else
    // on the same ellipse.
    for (const o of ROUND_TRIP_ORBITS) {
      for (let k = 0; k < 16; k++) {
        const M = (k / 16) * 2 * Math.PI;
        const { r, v } = stateAt(o, M);
        const g = cartesianToOrbitalElements(r, v, o.mu);
        const back = { x: 0, y: 0, z: 0 };
        orbitalStateToCartesian(
          g.a, g.e, g.incRad, g.nodeRad, g.argPeriRad,
          g.eccAnomalyRad - g.e * Math.sin(g.eccAnomalyRad),
          back,
        );
        const err = Math.hypot(back.x - r.x, back.y - r.y, back.z - r.z);
        expect(err / o.a, `${o.label} at M=${M.toFixed(3)}`).toBeLessThan(1e-8);
      }
    }
  });
});

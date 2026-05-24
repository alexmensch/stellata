import { describe, it, expect } from 'vitest';
import { solveKepler, wrapAngle } from './kepler-solver';

describe('wrapAngle', () => {
  it('reduces angles to (-π, π]', () => {
    expect(wrapAngle(0)).toBeCloseTo(0, 15);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 15);
    expect(wrapAngle(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1, 12);
    expect(wrapAngle(-Math.PI - 0.1)).toBeCloseTo(Math.PI - 0.1, 12);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(Math.PI, 12);
  });
});

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

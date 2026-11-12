import { describe, it, expect } from 'vitest';
import {
  GALACTIC_ESCAPE_VELOCITY_PC_YR, KM_S_TO_PC_YR, VELOCITY_SANITY_CEILING_PC_YR, speedBand, velocityPcPerYr,
} from './velocity';
import { MAS_TO_RAD } from '../../../src/astro-core/astronomy-constants';
import { equatorialTangentBasis } from '../../../src/astro-core/equatorial-basis';

describe('velocityPcPerYr', () => {
  it('pins the km/s → pc/yr conversion', () => {
    // 1 Julian yr (3.15576e7 s) / 1 pc (3.0856775814913673e13 km).
    expect(KM_S_TO_PC_YR).toBeCloseTo(1.0227121650e-6, 15);
  });

  it('pure radial velocity lands along û with no tangential term', () => {
    const v = velocityPcPerYr(0, 0, null, null, 5, 100);
    expect(v.x).toBeCloseTo(100 * KM_S_TO_PC_YR, 18);
    expect(v.y).toBeCloseTo(0, 18);
    expect(v.z).toBeCloseTo(0, 18);
  });

  it('pure east/north PM scale with distance and never divide by cos δ', () => {
    // At (0,0): east = +y, north = +z. μ_α* is already cos δ-applied.
    const east = velocityPcPerYr(0, 0, 1000, 0, 3, 0);
    expect(east.x).toBeCloseTo(0, 18);
    expect(east.y).toBeCloseTo(3 * MAS_TO_RAD * 1000, 18);
    expect(east.z).toBeCloseTo(0, 18);
    const north = velocityPcPerYr(0, 0, 0, 1000, 3, 0);
    expect(north.z).toBeCloseTo(3 * MAS_TO_RAD * 1000, 18);
    // A high-declination star: μ_α* still maps straight onto east, so the
    // tangential speed is distance × μ, independent of dec (the cos δ is
    // already folded into μ_α*). The ecliptic-pole sign-flip bug class
    // would corrupt this.
    const hi = velocityPcPerYr(45, 80, 500, 0, 3, 0);
    const speedMasyr = Math.hypot(hi.x, hi.y, hi.z) / (3 * MAS_TO_RAD);
    expect(speedMasyr).toBeCloseTo(500, 6);
  });

  it("reproduces Barnard's Star space velocity (~142 km/s) from published μ+ϖ+RV", () => {
    // Gaia DR3: μ_α* = −798.71, μ_δ = +10337.77 mas/yr; ϖ = 546.98 mas
    // (d = 1.8282 pc); RV = −110.51 km/s. Tangential v_t = 4.74047·μ″·d.
    const d = 1000 / 546.98;
    const v = velocityPcPerYr(269.448, 4.693, -798.71, 10337.77, d, -110.51);
    const speedKmS = Math.hypot(v.x, v.y, v.z) / KM_S_TO_PC_YR;
    expect(speedKmS).toBeCloseTo(142.4, 0);
    // Radial component along û equals RV exactly.
    const u = equatorialTangentBasis(269.448, 4.693).u;
    const radialKmS = (v.x * u.x + v.y * u.y + v.z * u.z) / KM_S_TO_PC_YR;
    expect(radialKmS).toBeCloseTo(-110.51, 3);
    // Tangential matches the textbook 4.74·μ·d formula.
    const muArcsec = Math.hypot(798.71, 10337.77) / 1000;
    const tangentialKmS = Math.sqrt(speedKmS ** 2 - radialKmS ** 2);
    expect(tangentialKmS).toBeCloseTo(4.740470 * muArcsec * d, 1);
  });
});

describe('speedBand', () => {
  it('keeps a speed at either threshold in the band below it', () => {
    expect(speedBand(0)).toBe('bound');
    expect(speedBand(GALACTIC_ESCAPE_VELOCITY_PC_YR)).toBe('bound');
    expect(speedBand(GALACTIC_ESCAPE_VELOCITY_PC_YR * 1.0001)).toBe('above_escape');
    expect(speedBand(VELOCITY_SANITY_CEILING_PC_YR)).toBe('above_escape');
    expect(speedBand(VELOCITY_SANITY_CEILING_PC_YR * 1.0001)).toBe('clamped');
  });
});

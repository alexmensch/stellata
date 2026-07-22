import { describe, it, expect } from 'vitest';
import {
  TAU_PER_AV,
  AV_RATE_PER_NH,
  cloudModelDensity,
  absorptionAlpha,
} from './cloud-presence-pure';

describe('cloudModelDensity', () => {
  // Taurus (clouds.json v3): n0Cal 355.55, rflat 1.2, p 1.2, uEnv 1, sMin 9.5.
  it('equals n0Cal at the centroid', () => {
    expect(cloudModelDensity(0, 9.5, 355.55, 1.2, 1.2, 1)).toBe(355.55);
  });

  it('pins the Taurus mid-profile value (u = 0.5 → r_eff = 4.75 pc)', () => {
    const n = cloudModelDensity(0.5, 9.5, 355.55, 1.2, 1.2, 1);
    // (1 + (4.75/1.2)²)^(−0.6) × 355.55
    expect(n).toBeCloseTo(65.7301, 4);
  });

  it('reaches exactly zero at the envelope edge and beyond', () => {
    expect(cloudModelDensity(1, 9.5, 355.55, 1.2, 1.2, 1)).toBe(0);
    expect(cloudModelDensity(1.5, 9.5, 355.55, 1.2, 1.2, 1)).toBe(0);
  });

  it('tightened envelope (uEnv < 1) cuts the profile early', () => {
    expect(cloudModelDensity(0.5, 10, 100, 5, 2, 0.49)).toBe(0);
    expect(cloudModelDensity(0.3, 10, 100, 5, 2, 0.49)).toBeGreaterThan(0);
  });
});

describe('absorptionAlpha', () => {
  it('pins the map at the Ophiuchus peak column (A_V = 2.73)', () => {
    expect(absorptionAlpha(2.73)).toBeCloseTo(0.9191, 4);
  });
  it('caps at 0.95', () => {
    expect(absorptionAlpha(10)).toBe(0.95);
  });
  it('is zero for a clean sightline', () => {
    expect(absorptionAlpha(0)).toBe(0);
  });
  it('uses τ = 0.921·A_V and the § 2 A_V rate', () => {
    expect(TAU_PER_AV).toBe(0.921);
    expect(AV_RATE_PER_NH).toBe(1.65e-3);
  });
});

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MAX_OCTAVES,
  NOISE_NORM,
  TAU_PER_AV,
  AV_RATE_PER_NH,
  buildOctaveLadder,
  bandLimitFade,
  cloudModelDensity,
  absorptionAlpha,
  ridgedShapeMean,
  valueNoise,
  latticeValue,
  type NoiseModel,
} from './cloud-presence-pure';

// The shipped noiseModel constants (scripts/clouds/cloud_model.py →
// clouds.json v2; pinned there by scripts/clouds/clouds-json.test.ts).
const NM: Pick<NoiseModel, 'lacunarity' | 'betaSpectral' | 'lambdaMinPc'> = {
  lacunarity: 2,
  betaSpectral: 2,
  lambdaMinPc: 0.3,
};

describe('buildOctaveLadder', () => {
  it('pins the Taurus ladder (major diameter 44 pc): 8 octaves, halving to ≥ 0.3 pc', () => {
    const ladder = buildOctaveLadder(44, NM);
    expect(ladder.lambdasPc).toEqual([44, 22, 11, 5.5, 2.75, 1.375, 0.6875, 0.34375]);
  });

  it('normalises amplitudes to unit total variance', () => {
    const { amps } = buildOctaveLadder(44, NM);
    const total = amps.reduce((a, b) => a + b * b, 0);
    expect(total).toBeCloseTo(1, 12);
  });

  it('doubles per-octave variance toward fine scales (β = 2 → ratio 2^(3−β) = 2)', () => {
    const { amps } = buildOctaveLadder(44, NM);
    for (let k = 1; k < amps.length; k++) {
      expect((amps[k] / amps[k - 1]) ** 2).toBeCloseTo(2, 12);
    }
  });

  it('every built cloud fits the MAX_OCTAVES uniform budget', () => {
    const path = resolve(__dirname, '../../../public/clouds.json');
    if (!existsSync(path)) return; // self-skip until `pnpm run build:clouds`
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      clouds: Array<{ axes: [number, number, number] }>;
    };
    for (const c of raw.clouds) {
      const ladder = buildOctaveLadder(2 * Math.max(...c.axes), NM);
      expect(ladder.lambdasPc.length).toBeLessThanOrEqual(MAX_OCTAVES);
    }
  });
});

describe('bandLimitFade (§ 9.1 rule 1)', () => {
  it('zero at and below λ = 2Δ (the octave may not contribute)', () => {
    expect(bandLimitFade(2, 1)).toBe(0);
    expect(bandLimitFade(1, 1)).toBe(0);
  });
  it('full contribution from λ = 4Δ', () => {
    expect(bandLimitFade(4, 1)).toBe(1);
    expect(bandLimitFade(40, 1)).toBe(1);
  });
  it('smooth between (λ = 3Δ → 0.5)', () => {
    expect(bandLimitFade(3, 1)).toBeCloseTo(0.5, 12);
  });
});

describe('cloudModelDensity', () => {
  // Taurus (clouds.json v2): n0Cal 355.55, rflat 1.2, p 1.2, uEnv 1, sMin 9.5.
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

describe('ridgedShapeMean', () => {
  it('is the analytic E[(1−|g|)^e] for g ~ U[-1,1]: 1/(e+1)', () => {
    expect(ridgedShapeMean(2)).toBeCloseTo(1 / 3, 12);
    expect(ridgedShapeMean(3)).toBe(0.25);
  });
});

describe('value noise (PCG3D + quintic)', () => {
  it('stays in [-1, 1] and is deterministic under a fixed seed', () => {
    for (let i = 0; i < 500; i++) {
      const v = valueNoise(i * 0.731, i * 1.317, i * 2.113, 3984726877);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(valueNoise(1.5, 2.5, 3.5, 42)).toBe(valueNoise(1.5, 2.5, 3.5, 42));
  });

  it('decorrelates under different seeds (per-cloud / per-octave structure)', () => {
    expect(valueNoise(1.5, 2.5, 3.5, 42)).not.toBe(valueNoise(1.5, 2.5, 3.5, 43));
  });

  it('handles negative lattice cells (cloud-local coordinates span the origin)', () => {
    const v = latticeValue(-7, -3, -11, 42);
    expect(v).toBeGreaterThanOrEqual(-1);
    expect(v).toBeLessThanOrEqual(1);
  });

  it('NOISE_NORM pins the measured 1/std of the raw octave noise', () => {
    let s = 0;
    let s2 = 0;
    const n = 200000;
    for (let i = 0; i < n; i++) {
      const v = valueNoise((i * 0.7371) % 97.3, (i * 1.317) % 89.1, (i * 2.113) % 83.7, 1234567);
      s += v;
      s2 += v * v;
    }
    const mean = s / n;
    const std = Math.sqrt(s2 / n - mean * mean);
    expect(1 / std).toBeCloseTo(NOISE_NORM, 1);
  });
});

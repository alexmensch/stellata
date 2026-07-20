// Pins the clouds.json v2 payload: calibrated density-model fields,
// presence-only class defaults, and the noiseModel constants. Self-skips
// when the artifact isn't built; runs for real in CI's tier-a-corpus job.

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLOUDS_JSON = resolve(ROOT, 'public', 'clouds.json');

interface CloudV2 {
  name: string;
  id: string;
  source: string;
  inGrid: boolean;
  class: 'dark' | 'sf' | 'hii';
  sigmaS: number;
  seed: number;
  embedded: unknown[];
  n0Cal: number;
  uEnv: number;
  rflat: number;
  p: number;
  massLeike: number | null;
  akPeak: number | null;
  mass?: number;
}

// The calibration contract (docs/molecular-clouds.md § 4.2): n0Cal sets the
// centroid shortest-axis column to akPeak/0.117 mag; uEnv < 1 records the
// mass-budget envelope tightening. Any drift here means the calibration
// inputs (Zucker tables, constants, integrator) changed.
const PROFILED_PINS: Record<
  string,
  { cls: string; n0Cal: number; uEnv: number; massLeike: number; akPeak: number }
> = {
  chamaeleon: { cls: 'dark', n0Cal: 240.96, uEnv: 0.8906, massLeike: 4397, akPeak: 0.29 },
  ophiuchus: { cls: 'sf', n0Cal: 193.03, uEnv: 1, massLeike: 7885, akPeak: 0.31 },
  lupus: { cls: 'dark', n0Cal: 138.53, uEnv: 0.999, massLeike: 8852, akPeak: 0.28 },
  taurus: { cls: 'dark', n0Cal: 355.55, uEnv: 1, massLeike: 14931, akPeak: 0.38 },
  perseus: { cls: 'sf', n0Cal: 281.98, uEnv: 1, massLeike: 13314, akPeak: 0.28 },
  musca: { cls: 'dark', n0Cal: 229.61, uEnv: 0.9591, massLeike: 486, akPeak: 0.19 },
  pipe: { cls: 'dark', n0Cal: 234.94, uEnv: 0.4881, massLeike: 522, akPeak: 0.23 },
  cepheus: { cls: 'dark', n0Cal: 343.99, uEnv: 0.7247, massLeike: 10414, akPeak: 0.33 },
  'orion-a': { cls: 'hii', n0Cal: 214.42, uEnv: 1, massLeike: 9434, akPeak: 0.34 },
  'orion-b': { cls: 'hii', n0Cal: 122.23, uEnv: 1, massLeike: 17325, akPeak: 0.33 },
  // Orion λ slugifies to bare 'orion' (the λ strips) — the pre-existing v1 id.
  orion: { cls: 'hii', n0Cal: 512.21, uEnv: 0.2229, massLeike: 856, akPeak: 0.22 },
};

describe.skipIf(!existsSync(CLOUDS_JSON))('clouds.json v2', () => {
  const payload = existsSync(CLOUDS_JSON)
    ? (JSON.parse(readFileSync(CLOUDS_JSON, 'utf-8')) as {
        version: number;
        count: number;
        noiseModel: Record<string, unknown>;
        clouds: CloudV2[];
      })
    : null!;

  it('carries version 2 and the full cloud set', () => {
    expect(payload.version).toBe(2);
    expect(payload.count).toBe(96);
    expect(payload.clouds).toHaveLength(96);
  });

  it('pins the noiseModel constants the presence shader consumes', () => {
    expect(payload.noiseModel).toEqual({
      lacunarity: 2.0,
      betaSpectral: 2.0,
      lambdaMinPc: 0.3,
      domainStretchMajor: 2.5,
      noiseClampSigma: 2.5,
      ridgedFinestCount: 2,
      ridgedExponent: { dark: 2.0, sf: 3.0, hii: 3.0 },
      sigmaS: { dark: 1.3, sf: 1.7, hii: 1.9 },
      hash: 'pcg3d',
      interp: 'quintic',
    });
  });

  it('pins the 11 calibrated profiled clouds', () => {
    for (const [id, pin] of Object.entries(PROFILED_PINS)) {
      const c = payload.clouds.find((x) => x.id === id);
      expect(c, id).toBeDefined();
      expect(c!.class, id).toBe(pin.cls);
      expect(c!.n0Cal, id).toBe(pin.n0Cal);
      expect(c!.uEnv, id).toBe(pin.uEnv);
      expect(c!.massLeike, id).toBe(pin.massLeike);
      expect(c!.akPeak, id).toBe(pin.akPeak);
      expect(c!.sigmaS, id).toBe({ dark: 1.3, sf: 1.7, hii: 1.9 }[pin.cls]);
    }
  });

  it('gives Corona Australis (bbox but no Table 2/3 rows) the class defaults', () => {
    const c = payload.clouds.find((x) => x.id === 'corona-australis')!;
    expect(c.source).toBe('Z2021T1');
    expect(c.class).toBe('sf');
    expect(c.massLeike).toBeNull();
    expect(c.akPeak).toBeNull();
    expect(c.p).toBe(2.0);
    expect(c.uEnv).toBe(1.0);
  });

  it('marks exactly the 18 clouds outside the ±1250 pc dust cube presence-only', () => {
    const out = payload.clouds.filter((c) => !c.inGrid).map((c) => c.name).sort();
    expect(out).toEqual([
      'Carina', 'GGD4', 'Gem OB1', 'IC 2944', 'IC 443', 'L291', 'L379',
      'M16', 'M17', 'Maddalena', 'NGC 6604', 'Rosette', 'Serpens OB2',
      'Sh2-231', 'Sh2-232', 'W3', 'W4', 'W5',
    ]);
  });

  it('every cloud carries the v2 model block', () => {
    for (const c of payload.clouds) {
      expect(['dark', 'sf', 'hii'], c.id).toContain(c.class);
      expect(c.n0Cal, c.id).toBeGreaterThan(0);
      expect(c.uEnv, c.id).toBeGreaterThan(0);
      expect(c.uEnv, c.id).toBeLessThanOrEqual(1);
      expect(c.rflat, c.id).toBeGreaterThan(0);
      expect(c.p, c.id).toBeGreaterThan(0);
      expect(c.seed, c.id).toBeGreaterThan(0);
      expect(Array.isArray(c.embedded), c.id).toBe(true);
      expect(typeof c.inGrid, c.id).toBe('boolean');
    }
  });
});

// Pins the clouds.json v3 payload: density-model fields, class defaults,
// noiseModel constants, and the alias / canonical-name table. Self-skips
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
  aliases?: string[];
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

// The calibration contract (docs/science-molecular-clouds.md § 4.2): n0Cal sets the
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

describe.skipIf(!existsSync(CLOUDS_JSON))('clouds.json v3', () => {
  const payload = existsSync(CLOUDS_JSON)
    ? (JSON.parse(readFileSync(CLOUDS_JSON, 'utf-8')) as {
        version: number;
        count: number;
        noiseModel: Record<string, unknown>;
        clouds: CloudV2[];
      })
    : null!;

  it('carries version 3 and the full cloud set', () => {
    expect(payload.version).toBe(3);
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
    // Pinned by stable id — display names are curated (m16 → "Eagle Nebula").
    const out = payload.clouds.filter((c) => !c.inGrid).map((c) => c.id).sort();
    expect(out).toEqual([
      'carina', 'gem-ob1', 'ggd4', 'ic-2944', 'ic-443', 'l291', 'l379',
      'm16', 'm17', 'maddalena', 'ngc-6604', 'rosette', 'serpens-ob2',
      'sh2-231', 'sh2-232', 'w3', 'w4', 'w5',
    ]);
  });

  it('splits the composite label and pins the canonical-name precedence', () => {
    // No label joins two names; the one former composite keeps its stable id.
    for (const c of payload.clouds) expect(c.name, c.id).not.toContain(' / ');
    const mon = payload.clouds.find((c) => c.id === 'mon-ob1-ngc-2264')!;
    expect(mon.name).toBe('NGC 2264');
    expect(mon.aliases).toContain('Mon OB1');
    // Whole-cloud common name outranks the Messier OR IC designation,
    // applied uniformly; the designation drops to an alias.
    const eagle = payload.clouds.find((c) => c.id === 'm16')!;
    expect(eagle.name).toBe('Eagle Nebula');
    expect(eagle.aliases).toEqual(['M16', 'NGC 6611', 'IC 4703']);
    const jellyfish = payload.clouds.find((c) => c.id === 'ic-443')!;
    expect(jellyfish.name).toBe('Jellyfish Nebula');
    expect(jellyfish.aliases).toContain('IC 443');
    // Carve-out: a sub-feature common name does NOT win the whole cloud.
    const carina = payload.clouds.find((c) => c.id === 'carina')!;
    expect(carina.name).toBe('Carina');
    expect(carina.aliases).toContain('Carina Nebula');
  });

  it('emits aliases only for curated clouds, never an empty array', () => {
    const withAliases = payload.clouds.filter((c) => c.aliases !== undefined);
    expect(withAliases.length).toBeGreaterThan(0);
    for (const c of withAliases) expect(c.aliases!.length, c.id).toBeGreaterThan(0);
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

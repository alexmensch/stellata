import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadClouds } from './cloud-loader';

interface RawTestCloud {
  name: string;
  id: string;
  sid?: number;
  center: [number, number, number];
  axes: [number, number, number];
  quat: [number, number, number, number];
  source: 'Z2021T1' | 'Z2020';
  distance: number;
  mass?: number;
  class: 'dark' | 'sf' | 'hii';
  n0Cal: number;
  uEnv: number;
  rflat: number;
  p: number;
  sigmaS: number;
  seed: number;
  inGrid: boolean;
  embedded: unknown[];
}

interface Raw {
  version: number;
  count: number;
  clouds: RawTestCloud[];
}

const savedFetch = (globalThis as { fetch?: unknown }).fetch;

function mockFetch(json: unknown) {
  (globalThis as { fetch: unknown }).fetch =
    async () => ({ ok: true, json: async () => json });
}

const baseCloud: RawTestCloud = {
  name: 'Orion A',
  id: 'orion-a',
  sid: 327400,
  center: [100, -50, -200],
  axes: [20, 10, 8],
  quat: [0, 0, 0, 1],
  source: 'Z2021T1',
  distance: 230,
  class: 'hii',
  n0Cal: 224.5,
  uEnv: 1,
  rflat: 8.1,
  p: 3.0,
  sigmaS: 1.9,
  seed: 123456789,
  inGrid: true,
  embedded: [],
};

describe('loadClouds', () => {
  beforeEach(() => {
    (globalThis as { fetch?: unknown }).fetch = undefined;
  });
  afterEach(() => {
    (globalThis as { fetch?: unknown }).fetch = savedFetch;
  });

  it('returns null on unsupported version (forward-compat guard)', async () => {
    mockFetch({ version: 3, count: 0, clouds: [] } satisfies Raw);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadClouds('/clouds.json')).toBeNull();
    warn.mockRestore();
  });

  it('parses a v2 catalog including the presence-model fields', async () => {
    mockFetch({
      version: 2,
      count: 1,
      clouds: [{ ...baseCloud, mass: 32122 }],
    } satisfies Raw);
    const out = await loadClouds('/clouds.json');
    expect(out).not.toBeNull();
    const c = out!.clouds[0];
    expect(c.name).toBe('Orion A');
    expect(c.sid).toBe(327400);
    expect(c.centerAbs.x).toBe(100);
    expect(c.distanceFromSol).toBe(230);
    expect(c.massMsun).toBe(32122);
    expect(c.cloudClass).toBe('hii');
    expect(c.n0Cal).toBe(224.5);
    expect(c.uEnv).toBe(1);
    expect(c.rflatPc).toBe(8.1);
    expect(c.p).toBe(3.0);
    expect(c.sigmaS).toBe(1.9);
    expect(c.seed).toBe(123456789);
    expect(c.inGrid).toBe(true);
    expect(c.embedded).toEqual([]);
  });

  it('maps a missing mass to null (Z2020 clouds carry none)', async () => {
    mockFetch({ version: 2, count: 1, clouds: [baseCloud] } satisfies Raw);
    const out = await loadClouds('/clouds.json');
    expect(out!.clouds[0].massMsun).toBeNull();
  });

  it('returns null when any cloud is missing its sid (pre-stamp artifact)', async () => {
    const { sid: _sid, ...noSid } = baseCloud;
    mockFetch({ version: 2, count: 1, clouds: [noSid] } satisfies Raw);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadClouds('/clouds.json')).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/clouds\.json record 0 has a missing or invalid sid/),
    );
    warn.mockRestore();
  });

  it('returns null on a duplicate sid', async () => {
    mockFetch({
      version: 2,
      count: 2,
      clouds: [baseCloud, { ...baseCloud, id: 'orion-b' }],
    } satisfies Raw);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadClouds('/clouds.json')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/duplicate sid 327400/));
    warn.mockRestore();
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadClouds } from './cloud-loader';

interface Raw {
  version: number;
  count: number;
  clouds: Array<{
    name: string;
    id: string;
    sid?: number;
    center: [number, number, number];
    axes: [number, number, number];
    quat: [number, number, number, number];
    source: 'Z2021T1' | 'Z2020';
    distance: number;
    mass?: number;
  }>;
}

const savedFetch = (globalThis as { fetch?: unknown }).fetch;

function mockFetch(json: unknown) {
  (globalThis as { fetch: unknown }).fetch =
    async () => ({ ok: true, json: async () => json });
}

const baseCloud = {
  name: 'Orion A',
  id: 'orion-a',
  sid: 327400,
  center: [100, -50, -200] as [number, number, number],
  axes: [20, 10, 8] as [number, number, number],
  quat: [0, 0, 0, 1] as [number, number, number, number],
  source: 'Z2021T1' as const,
  distance: 230,
};

describe('loadClouds', () => {
  beforeEach(() => {
    (globalThis as { fetch?: unknown }).fetch = undefined;
  });
  afterEach(() => {
    (globalThis as { fetch?: unknown }).fetch = savedFetch;
  });

  it('returns null on unsupported version (forward-compat guard)', async () => {
    mockFetch({ version: 2, count: 0, clouds: [] } satisfies Raw);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadClouds('/clouds.json')).toBeNull();
    warn.mockRestore();
  });

  it('parses a v1 catalog including the sid and mass columns', async () => {
    mockFetch({
      version: 1,
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
  });

  it('maps a missing mass to null (Z2020 clouds carry none)', async () => {
    mockFetch({ version: 1, count: 1, clouds: [baseCloud] } satisfies Raw);
    const out = await loadClouds('/clouds.json');
    expect(out!.clouds[0].massMsun).toBeNull();
  });

  it('returns null when any cloud is missing its sid (pre-stamp artifact)', async () => {
    const { sid: _sid, ...noSid } = baseCloud;
    mockFetch({ version: 1, count: 1, clouds: [noSid] } satisfies Raw);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadClouds('/clouds.json')).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/clouds\.json record 0 has a missing or invalid sid/),
    );
    warn.mockRestore();
  });

  it('returns null on a duplicate sid', async () => {
    mockFetch({
      version: 1,
      count: 2,
      clouds: [baseCloud, { ...baseCloud, id: 'orion-b' }],
    } satisfies Raw);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadClouds('/clouds.json')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/duplicate sid 327400/));
    warn.mockRestore();
  });
});

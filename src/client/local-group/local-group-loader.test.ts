import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadLocalGroup, type LgEmission } from './local-group-loader';

interface Raw {
  version: number;
  count: number;
  objects: Array<{
    name: string;
    id: string;
    sid?: number;
    center: [number, number, number];
    kind: 'disc' | 'ellipsoid';
    axes: [number, number, number];
    quat: [number, number, number, number];
    source: 'LVDB' | 'OVERRIDE';
    distance: number;
    emission: LgEmission;
  }>;
}

const DISC_EMISSION: LgEmission = {
  family: 'disc',
  mV: 0.4,
  rdPc: 1500,
  zdPc: 333.33,
  rEnvPc: 6000,
  zEnvPc: 1333.33,
  density0: 0.20821438,
};

const savedFetch = (globalThis as { fetch?: unknown }).fetch;

function mockFetch(impl: (url: string) => { ok: boolean; json: () => unknown } | Promise<never>) {
  (globalThis as { fetch: (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }> }).fetch =
    async (url: string) => {
      const r = await impl(url);
      // r might be a thrown rejection (transport error) — handled by impl returning Promise.reject.
      return {
        ok: (r as { ok: boolean }).ok,
        json: async () => (r as { json: () => unknown }).json(),
      };
    };
}

describe('loadLocalGroup', () => {
  beforeEach(() => {
    (globalThis as { fetch?: unknown }).fetch = undefined;
  });
  afterEach(() => {
    (globalThis as { fetch?: unknown }).fetch = savedFetch;
  });

  it('returns null on network error (no fetch throw upstream)', async () => {
    (globalThis as unknown as { fetch: () => Promise<never> }).fetch =
      () => Promise.reject(new Error('offline'));
    const out = await loadLocalGroup('/local-group.json');
    expect(out).toBeNull();
  });

  it('returns null on 404', async () => {
    mockFetch(() => ({ ok: false, json: () => ({}) }));
    const out = await loadLocalGroup('/local-group.json');
    expect(out).toBeNull();
  });

  it('returns null on unsupported version (pre-emission v1 artifact)', async () => {
    const raw: Raw = { version: 1, count: 0, objects: [] };
    mockFetch(() => ({ ok: true, json: () => raw }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await loadLocalGroup('/local-group.json');
    expect(out).toBeNull();
    expect(warn).toHaveBeenCalledWith('local-group.json version 1 unsupported');
    warn.mockRestore();
  });

  it('parses a v2 catalog into typed Vector3 / Quaternion objects', async () => {
    const raw: Raw = {
      version: 2,
      count: 1,
      objects: [{
        name: 'LMC',
        id: 'lmc',
        sid: 327500,
        center: [15000, 5000, -42000],
        kind: 'disc',
        axes: [4500, 4500, 1000],
        // pre-normalised unit quaternion
        quat: [0.1, 0.2, 0.3, Math.sqrt(1 - 0.01 - 0.04 - 0.09)],
        source: 'OVERRIDE',
        distance: 49590,
        emission: DISC_EMISSION,
      }],
    };
    mockFetch(() => ({ ok: true, json: () => raw }));
    const out = await loadLocalGroup('/local-group.json');
    expect(out).not.toBeNull();
    expect(out!.count).toBe(1);
    const o = out!.objects[0];
    expect(o.name).toBe('LMC');
    expect(o.kind).toBe('disc');
    expect(o.centerAbs.x).toBe(15000);
    expect(o.centerAbs.y).toBe(5000);
    expect(o.centerAbs.z).toBe(-42000);
    expect(o.quat.length()).toBeCloseTo(1, 6);
    expect(o.distanceFromSol).toBe(49590);
    expect(o.sid).toBe(327500);
    expect(o.emission).toEqual(DISC_EMISSION);
  });

  it('returns null when any object is missing its sid (pre-stamp artifact)', async () => {
    const raw: Raw = {
      version: 2,
      count: 1,
      objects: [{
        name: 'LMC',
        id: 'lmc',
        center: [0, 0, 0],
        kind: 'disc',
        axes: [1, 1, 1],
        quat: [0, 0, 0, 1],
        source: 'LVDB',
        distance: 1,
        emission: DISC_EMISSION,
      }],
    };
    mockFetch(() => ({ ok: true, json: () => raw }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await loadLocalGroup('/local-group.json');
    expect(out).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/local-group\.json record 0 has a missing or invalid sid/),
    );
    warn.mockRestore();
  });

  it('returns null on a duplicate sid', async () => {
    const obj = {
      name: 'X',
      id: 'x',
      sid: 5,
      center: [0, 0, 0] as [number, number, number],
      kind: 'disc' as const,
      axes: [1, 1, 1] as [number, number, number],
      quat: [0, 0, 0, 1] as [number, number, number, number],
      source: 'LVDB' as const,
      distance: 1,
      emission: DISC_EMISSION,
    };
    const raw: Raw = { version: 2, count: 2, objects: [obj, { ...obj, id: 'y' }] };
    mockFetch(() => ({ ok: true, json: () => raw }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await loadLocalGroup('/local-group.json');
    expect(out).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/duplicate sid 5/));
    warn.mockRestore();
  });
});

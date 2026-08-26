// LG kind-module contract: load-missing degrades to absence, and the
// capability legs answer from the loaded catalog after attach.

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLOBAL_MIN_DIST_PC } from '../camera/focus/focus-controller';
import type { KindContext } from '../kinds/kind-module';
import { makeKindContext } from '../kinds/kind-context-mock';
import { makeFrameCtx } from '../scene/frame-ctx-mock';
import { createLgKindModule } from './lg-module';

function rawObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Mock Dwarf',
    id: 'mock-dwarf',
    type: 'Dwarf spheroidal',
    sid: 1,
    center: [84_000, 0, 0],
    kind: 'ellipsoid',
    axes: [1000, 800, 600],
    quat: [0, 0, 0, 1],
    source: 'LVDB',
    distance: 84_000,
    emission: {
      family: 'sersic', mV: 8.6, reffAxesPc: [280, 224, 168],
      n: 1, bn: 1.678, pn: 1, uMax: 4.6, density0: 0.02,
    },
    ...overrides,
  };
}

function stubFetch(present: boolean): void {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (!present) return { ok: false, status: 404 } as Response;
    return {
      ok: true,
      json: async () => ({
        version: 2,
        count: 2,
        objects: [
          rawObject({
            name: 'M31', id: 'm31', sid: 1, type: 'Spiral galaxy',
            center: [776_000, 300_000, 0], distance: 776_000,
            aliases: ['Andromeda Galaxy', 'NGC 224'],
            kind: 'disc', axes: [21_200, 21_200, 667],
            emission: {
              family: 'disc', mV: 3.44, rdPc: 5300, zdPc: 167,
              rEnvPc: 21_200, zEnvPc: 667, density0: 0.34,
            },
          }),
          rawObject({ name: 'Sculptor Dwarf Spheroidal', id: 'sculptor', sid: 2 }),
        ],
      }),
    } as unknown as Response;
  }));
}

function makeCtx(): KindContext {
  const ctx = makeKindContext();
  ctx.camera.position.set(0, 0, 0);
  ctx.camera.lookAt(1, 0, 0);
  ctx.camera.updateMatrixWorld();
  return ctx;
}

afterEach(() => vi.unstubAllGlobals());

describe('lg kind module', () => {
  it('degrades to absence before load / when the artifact is missing', async () => {
    stubFetch(false);
    const m = createLgKindModule();
    expect(m.searchEntries()).toEqual([]);
    expect(m.displayName(0)).toBe('');
    expect(m.pinnable(0)).toBe(false);
    await m.load('/');
    expect(m.attach(makeCtx())).toBeNull();
    expect(m.layer).toBeNull();
    expect(m.emission).toBeNull();
    expect(m.sids()).toBeNull();
    const provider = m.focusable();
    expect(provider.anchorInto(0, new THREE.Vector3())).toBe(false);
    expect(provider.focusParkDistance(0)).toBe(0);
    expect(m.hover?.().pick(400, 300, 14)).toBeNull();
    expect(() => m.setEmissionEnabled(false)).not.toThrow();
  });

  it('answers every leg from the loaded catalog after attach', async () => {
    stubFetch(true);
    const m = createLgKindModule();
    await m.load('/');
    const ctx = makeCtx();
    const layer = m.attach(ctx);
    expect(layer).not.toBeNull();
    expect(m.layer?.objects).toHaveLength(2);
    expect(m.emission).not.toBeNull();

    expect(m.sids()).toEqual([1, 2]);
    expect(m.searchEntries().map((e) => e.label))
      .toEqual(['M31', 'Andromeda Galaxy', 'NGC 224', 'Sculptor Dwarf Spheroidal']);
    // Morphological type alone — no distance. Star rows carry a
    // constellation and cloud rows 'Molecular cloud'; a distance here made
    // LG the one kind whose row read differently.
    expect(m.searchEntries()[0].displayCon).toBe('Spiral galaxy');
    expect(m.searchEntries()[3].displayCon).toBe('Dwarf spheroidal');
    expect(m.displayName(1)).toBe('Sculptor Dwarf Spheroidal');
    expect(m.pinnable(0)).toBe(true);
    expect(m.pinnable(5)).toBe(false);

    const provider = m.focusable();
    const out = new THREE.Vector3();
    expect(provider.anchorInto(0, out)).toBe(true);
    expect(out.x).toBe(776_000);
    expect(provider.localPositionInto(1, out)).toBe(true);
    expect(out.x).toBe(84_000);
    // Park frames the whole object: 2.4 × the 21.2 kpc semi-axis.
    expect(provider.focusParkDistance(0)).toBeCloseTo(2.4 * 21_200, 6);
    expect(provider.orbitFloor(0)).toBe(GLOBAL_MIN_DIST_PC);
    expect(provider.arrivalRadiusPc(0)).toBeNull();
    expect(provider.renderedSizePx(0)).toBeGreaterThan(0);

    const card = m.card();
    expect(card.kind).toBe('lg');
    expect(card.format(0).name).toBe('M31');

    // The emission-enable leg is what the shell's lgEmissionGlow bind
    // pushes through.
    m.setEmissionEnabled(false);
    expect(m.emission?.isEnabled()).toBe(false);
    m.setEmissionEnabled(true);
    expect(m.emission?.isEnabled()).toBe(true);
  });

  it('picks the wireframe silhouette through the shared hover surface', async () => {
    stubFetch(true);
    const m = createLgKindModule();
    await m.load('/');
    const ctx = makeCtx();
    const sceneLayer = m.attach(ctx)!;
    // The wireframe pick gates on group.visible, which update() flips on
    // once the camera sits past the Sol-distance fade.
    sceneLayer.update?.(makeFrameCtx(ctx.camera, { distFromSol: 10_000 }));
    const { pick } = m.hover!();
    // Sculptor's centroid sits dead ahead at screen centre (400, 300).
    const hit = pick(400, 300, 14);
    expect(hit?.idx).toBe(1);
    expect(hit?.cameraDistancePc).toBeCloseTo(84_000, 0);
    expect(pick(10, 10, 14)).toBeNull();
    // Warp hides the reference wireframe — and with it the pick.
    sceneLayer.update?.(makeFrameCtx(ctx.camera, { distFromSol: 10_000, warpActive: true }));
    expect(pick(400, 300, 14)).toBeNull();
  });
});

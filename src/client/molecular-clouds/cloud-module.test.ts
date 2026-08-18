// Cloud kind-module contract: load-missing degrades to absence, the
// capability legs answer from the loaded catalog after attach, and the
// shared pick surface resolves overlapping clouds.

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLOBAL_MIN_DIST_PC } from '../camera/focus/focus-controller';
import type { KindContext } from '../kinds/kind-module';
import { makeKindContext } from '../kinds/kind-context-mock';
import type { FrameCtx } from '../scene/scene-layer';
import { makeLabelDom } from '../ui/label-dom-mock';
import { CLOUD_LABELS_GROUP_ID } from './cloud-labels';
import { createCloudKindModule } from './cloud-module';

function rawCloud(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Mock',
    id: 'mock',
    sid: 1,
    center: [0, 0, 0],
    axes: [10, 10, 10],
    quat: [0, 0, 0, 1],
    source: 'Z2020',
    distance: 100,
    class: 'dark',
    n0Cal: 100,
    uEnv: 1,
    rflat: 1.2,
    p: 2,
    sigmaS: 1.3,
    seed: 12345,
    inGrid: true,
    embedded: [],
    ...overrides,
  };
}

/** clouds.json fixture: a 10 pc sphere at the origin (with aliases) plus
 *  a 3 pc sphere between it and a camera at (0,0,30), whose silhouette
 *  nests inside the big one. cloud-surfaces.bin is always missing, so
 *  every cloud uses its ellipsoid fallback shape. */
function stubFetch(present: boolean): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (!present || !url.includes('clouds.json')) {
      return { ok: false, status: 404 } as Response;
    }
    return {
      ok: true,
      json: async () => ({
        version: 3,
        count: 2,
        clouds: [
          rawCloud({
            name: 'Eagle Nebula', id: 'm16', sid: 1, aliases: ['M16', 'NGC 6611'],
          }),
          rawCloud({
            name: 'Taurus', id: 'taurus', sid: 2, axes: [3, 3, 3], center: [2.4, 0, 12],
          }),
        ],
      }),
    } as unknown as Response;
  }));
}

function makeCtx(overrides: Partial<KindContext> = {}): KindContext {
  const ctx = makeKindContext(overrides);
  ctx.camera.position.set(0, 0, 30);
  ctx.camera.lookAt(0, 0, 0);
  ctx.camera.updateMatrixWorld();
  return ctx;
}

function frameCtx(ctx: KindContext): FrameCtx {
  return {
    camera: ctx.camera,
    worldOffset: new THREE.Vector3(),
    distFromSol: 0,
    t: 0,
    warpActive: false,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('cloud kind module', () => {
  it('degrades to absence before load / when the artifact is missing', async () => {
    stubFetch(false);
    const m = createCloudKindModule();
    expect(m.searchEntries()).toEqual([]);
    expect(m.displayName(0)).toBe('');
    expect(m.pinnable(0)).toBe(false);
    await m.load('/');
    const ctx = makeCtx();
    expect(m.attach(ctx)).toBeNull();
    expect(m.layer).toBeNull();
    expect(m.sids()).toBeNull();
    expect(m.searchEntries()).toEqual([]);
    expect(m.renderedSizePx(0)).toBe(0);
    const provider = m.focusable();
    expect(provider.localPositionInto(0, new THREE.Vector3())).toBe(false);
    expect(provider.focusParkDistance(0)).toBe(0);
    expect(m.hover?.().pick(400, 300, 14)).toBeNull();
  });

  it('answers every leg from the loaded catalog after attach', async () => {
    stubFetch(true);
    const m = createCloudKindModule();
    await m.load('/');
    const ctx = makeCtx();
    const layer = m.attach(ctx);
    expect(layer).not.toBeNull();
    expect(m.layer?.clouds).toHaveLength(2);

    expect(m.sids()).toEqual([1, 2]);
    expect(m.searchEntries().map((e) => e.label))
      .toEqual(['Eagle Nebula', 'M16', 'NGC 6611', 'Taurus']);
    expect(m.searchEntries().every((e) => e.displayCon === 'Molecular cloud')).toBe(true);
    expect(m.searchEntries()[1].index).toBe(0);
    expect(m.displayName(1)).toBe('Taurus');
    expect(m.pinnable(0)).toBe(false);

    const provider = m.focusable();
    const local = new THREE.Vector3();
    expect(provider.localPositionInto(0, local)).toBe(true);
    expect(local.length()).toBeCloseTo(0, 10);
    expect(provider.localPositionInto(5, local)).toBe(false);
    // Ellipsoid fallback: extent = maxAxis × uEnv = 10 pc, park at the
    // 2.4× viewing distance the soft-focus rule prescribes.
    expect(provider.focusParkDistance(0)).toBeCloseTo(24, 6);
    // Soft kinds never tighten the manual-zoom floor below the
    // unfocused global one, whatever the park distance.
    expect(provider.orbitFloor(0)).toBe(GLOBAL_MIN_DIST_PC);
    expect(provider.arrivalRadiusPc(0)).toBeNull();
    expect(provider.renderedSizePx(0)).toBeGreaterThan(0);

    const card = m.card();
    expect(card.kind).toBe('cloud');
    expect(card.format(0).name).toBe('Eagle Nebula');
  });

  it('picks through the shared hover surface, deepest-inside winning overlaps', async () => {
    stubFetch(true);
    const m = createCloudKindModule();
    await m.load('/');
    const ctx = makeCtx();
    m.attach(ctx)!.update!(frameCtx(ctx));
    ctx.scene.updateMatrixWorld(true);

    const { pick } = m.hover!();
    const centre = pick(400, 300, 14);
    expect(centre?.idx).toBe(0);
    expect(centre?.tier).toBe('fallback');
    expect(centre?.cameraDistancePc).toBeCloseTo(30, 5);
    expect(pick(799, 599, 14)).toBeNull();

    // Sweep the overlap region: the winner flips from the big complex to
    // the small foreground cloud somewhere along the sweep.
    const winners = new Set<number>();
    const v = new THREE.Vector3();
    for (let x = 0; x <= 3.4; x += 0.2) {
      v.set(x, 0, 12).project(ctx.camera);
      const hit = pick((v.x + 1) * 0.5 * 800, (1 - v.y) * 0.5 * 600, 14);
      if (hit) winners.add(hit.idx);
    }
    expect(winners).toEqual(new Set([0, 1]));
  });

  it('refuses the pick that would have hit once the declutter permit drops', async () => {
    stubFetch(true);
    const m = createCloudKindModule();
    await m.load('/');
    let permitted = true;
    const ctx = makeCtx({ detailPermits: () => permitted });
    const layer = m.attach(ctx)!;
    ctx.scene.updateMatrixWorld(true);
    const { pick } = m.hover!();

    layer.update!(frameCtx(ctx));
    expect(pick(400, 300, 14)?.idx).toBe(0);

    permitted = false;
    layer.update!(frameCtx(ctx));
    expect(pick(400, 300, 14)).toBeNull();
  });

  it('runs the label teardown from its scene layer dispose', async () => {
    stubFetch(true);
    const m = createCloudKindModule();
    await m.load('/');
    const dom = makeLabelDom([CLOUD_LABELS_GROUP_ID]);
    vi.stubGlobal('document', dom.document);
    const frames: (() => void)[] = [];
    let unsubscribed = 0;
    const layer = m.attach(makeKindContext({
      onFrame: (handler) => {
        frames.push(handler);
        return () => { unsubscribed++; };
      },
    }))!;

    m.labels!();
    // One <text> + one bound label engine per cloud.
    expect(dom.nodes.size).toBe(2);
    expect(frames).toHaveLength(2);

    layer.dispose();
    expect(unsubscribed).toBe(2);
    expect(dom.removed()).toBe(2);
  });
});

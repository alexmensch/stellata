// Shell kind-module contract: the heliopause registers off the Sol
// record alone, the Local Bubble slot follows its artifact, and the
// SID domain is static either way.

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLOBAL_MIN_DIST_PC } from '../camera/focus/focus-controller';
import type { KindContext } from '../kinds/kind-module';
import { makeKindContext } from '../kinds/kind-context-mock';
import { HELIOPAUSE_EXTENT_PC } from '../solar-system/heliopause/heliopause';
import { SHELL_OBJECT_SIDS } from './shell-object-sids';
import { createShellKindModule } from './shell-module';

/** Minimal LBUB buffer: an octahedron of wall vertices around a
 *  centroid at (50, 0, 0), 100 pc out along each axis. */
function makeLocalBubbleBin(): ArrayBuffer {
  const centroid = [50, 0, 0];
  const verts: number[] = [];
  for (const axis of [0, 1, 2]) {
    for (const sign of [1, -1]) {
      const v = [...centroid];
      v[axis] += 100 * sign;
      verts.push(...v);
    }
  }
  const indices = [0, 2, 4, 1, 3, 5];
  const buf = new ArrayBuffer(32 + verts.length * 4 + indices.length * 4);
  const view = new DataView(buf);
  view.setUint32(0, 0x4c425542, false);
  view.setUint32(8, verts.length / 3, true);
  view.setUint32(12, indices.length, true);
  view.setFloat32(16, centroid[0], true);
  view.setFloat32(20, centroid[1], true);
  view.setFloat32(24, centroid[2], true);
  new Float32Array(buf, 32, verts.length).set(verts);
  new Uint32Array(buf, 32 + verts.length * 4, indices.length).set(indices);
  return buf;
}

function stubFetch(present: boolean): void {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (!present) return { ok: false, status: 404 } as Response;
    return {
      ok: true,
      arrayBuffer: async () => makeLocalBubbleBin(),
    } as unknown as Response;
  }));
}

function stubDocument(): void {
  vi.stubGlobal('document', { getElementById: () => null });
}

function makeCtx(): KindContext {
  const ctx = makeKindContext();
  ctx.camera.position.set(50, 0, 300);
  ctx.camera.lookAt(50, 0, 0);
  ctx.camera.updateMatrixWorld();
  return ctx;
}

afterEach(() => vi.unstubAllGlobals());

describe('shell kind module', () => {
  it('registers the heliopause alone when the Local Bubble artifact is missing', async () => {
    stubFetch(false);
    const m = createShellKindModule();
    await m.load('/');
    expect(m.attach(makeCtx())).not.toBeNull();
    // SHELL_KEYS order: idx 0 = local_bubble (absent), idx 1 = heliopause.
    expect(m.displayName(0)).toBe('');
    expect(m.displayName(1)).toBe('Heliopause');
    expect(m.pinnable(0)).toBe(false);
    expect(m.pinnable(1)).toBe(true);
    expect(m.searchEntries().map((e) => e.label)).toEqual(['Heliopause']);
    // The SID domain is static — both slots resolve with no artifact.
    expect(m.sids()).toEqual([SHELL_OBJECT_SIDS.local_bubble, SHELL_OBJECT_SIDS.heliopause]);
    const provider = m.focusable();
    expect(provider.focusParkDistance(0)).toBe(0);
    expect(provider.focusParkDistance(1)).toBeCloseTo(2.4 * HELIOPAUSE_EXTENT_PC, 10);
  });

  it('registers both shells and answers every leg with the artifact present', async () => {
    stubFetch(true);
    const m = createShellKindModule();
    await m.load('/');
    const ctx = makeCtx();
    const layer = m.attach(ctx);
    expect(layer).not.toBeNull();

    expect(m.searchEntries().map((e) => e.label)).toEqual(['Local Bubble', 'Heliopause']);
    expect(m.searchEntries()[0].displayCon).toBe('Interstellar medium cavity');
    expect(m.displayName(0)).toBe('Local Bubble');
    expect(m.pinnable(0)).toBe(true);

    const provider = m.focusable();
    const out = new THREE.Vector3();
    expect(provider.anchorInto(0, out)).toBe(true);
    expect(out.x).toBe(50);
    expect(provider.localPositionInto(0, out)).toBe(true);
    // Whole-shell framing: park = 2.4 × the 100 pc wall extent.
    expect(provider.focusParkDistance(0)).toBeCloseTo(240, 6);
    expect(provider.orbitFloor(0)).toBe(GLOBAL_MIN_DIST_PC);
    expect(provider.arrivalRadiusPc(0)).toBeNull();

    const card = m.card();
    expect(card.kind).toBe('shell');
    expect(card.format(0).name).toBe('Local Bubble');
    expect(card.format(1).name).toBe('Heliopause');
  });

  it('picks the drawn silhouette once the declutter push permits it', async () => {
    stubFetch(true);
    stubDocument();
    const m = createShellKindModule();
    await m.load('/');
    const ctx = makeCtx();
    m.attach(ctx);
    const { pick } = m.hover!();
    // Both shells start unpermitted (fresnel-shell/README.md
    // § Invariants) — nothing is drawn, so nothing picks.
    expect(pick(400, 300, 14)).toBeNull();
    const binds = m.detailBinds!();
    binds.localBubbleShell!(true);
    binds.heliopauseShell!(true);
    const hit = pick(400, 300, 14);
    expect(hit?.idx).toBe(0);
    expect(hit?.tier).toBe('fallback');
    expect(hit?.cameraDistancePc).toBeCloseTo(300, 5);
    expect(pick(790, 590, 14)).toBeNull();
    // Un-permitting hides the wall and its pick together.
    binds.localBubbleShell!(false);
    expect(pick(400, 300, 14)).toBeNull();
  });
});

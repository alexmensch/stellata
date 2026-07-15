import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SceneLayerRegistry, type FrameCtx, type SceneLayer } from './scene-layer';

function makeCtx(warpActive = false): FrameCtx {
  return {
    camera: new THREE.PerspectiveCamera(),
    worldOffset: new THREE.Vector3(),
    distFromSol: 0,
    t: 0,
    warpActive,
  };
}

describe('SceneLayerRegistry', () => {
  it('updateAll runs every registered update hook in registration order', () => {
    const reg = new SceneLayerRegistry();
    const order: string[] = [];
    const layer = (name: string): SceneLayer => ({
      update: () => { order.push(name); },
      dispose: () => {},
    });
    reg.register(layer('a'));
    reg.register(layer('b'));
    reg.register(layer('c'));
    reg.updateAll(makeCtx());
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('skips optional hooks a layer omits, without affecting the others', () => {
    const reg = new SceneLayerRegistry();
    const calls: string[] = [];
    reg.register({ dispose: () => { calls.push('disposeOnly'); } });
    reg.register({
      update: () => { calls.push('update'); },
      setMonochrome: (on) => { calls.push(`mono:${on}`); },
      recenter: (o) => { calls.push(`recenter:${o.x}`); },
      dispose: () => { calls.push('dispose'); },
    });
    reg.updateAll(makeCtx());
    reg.setMonochromeAll(true);
    reg.recenterAll(new THREE.Vector3(7, 0, 0));
    reg.disposeAll();
    expect(calls).toEqual(['update', 'mono:true', 'recenter:7', 'disposeOnly', 'dispose']);
  });

  it('disposeAll reaches every registered layer — registration implies inclusion', () => {
    const reg = new SceneLayerRegistry();
    const disposed = new Set<number>();
    for (let i = 0; i < 5; i++) {
      reg.register({ dispose: () => { disposed.add(i); } });
    }
    reg.disposeAll();
    expect(disposed.size).toBe(5);
  });

  it('passes the shared FrameCtx through to each update', () => {
    const reg = new SceneLayerRegistry();
    const seen: FrameCtx[] = [];
    reg.register({ update: (ctx) => { seen.push(ctx); }, dispose: () => {} });
    reg.register({ update: (ctx) => { seen.push(ctx); }, dispose: () => {} });
    const ctx = makeCtx(true);
    reg.updateAll(ctx);
    expect(seen[0]).toBe(ctx);
    expect(seen[1]).toBe(ctx);
    expect(seen[0].warpActive).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  SceneLayerRegistry,
  type FrameCtx,
  type LayerTimeBehaviour,
  type SceneLayer,
} from './scene-layer';

function makeCtx(warpActive = false): FrameCtx {
  return {
    camera: new THREE.PerspectiveCamera(),
    worldOffset: new THREE.Vector3(),
    distFromSol: 0,
    t: 0,
    warpActive,
    pxPerRadian: 900,
    pixelRatio: 1,
  };
}

const STATIC: LayerTimeBehaviour = { kind: 'static' };
const clock = (budgetSimS: number): LayerTimeBehaviour =>
  ({ kind: 'clock', budgetSimS: () => budgetSimS });
const realtime = (needsFrames: boolean): LayerTimeBehaviour =>
  ({ kind: 'realtime', needsFrames: () => needsFrames });

describe('SceneLayerRegistry', () => {
  it('updateAll runs every registered update hook in registration order', () => {
    const reg = new SceneLayerRegistry();
    const order: string[] = [];
    const layer = (name: string): SceneLayer => ({
      timeBehaviour: STATIC,
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
    reg.register({ timeBehaviour: STATIC, dispose: () => { calls.push('disposeOnly'); } });
    reg.register({
      timeBehaviour: STATIC,
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
      reg.register({ timeBehaviour: STATIC, dispose: () => { disposed.add(i); } });
    }
    reg.disposeAll();
    expect(disposed.size).toBe(5);
  });

  it('minCadenceBudgetS is the min over clock layers, Infinity otherwise', () => {
    const reg = new SceneLayerRegistry();
    reg.register({ timeBehaviour: STATIC, dispose: () => {} });
    expect(reg.minCadenceBudgetS(makeCtx())).toBe(Number.POSITIVE_INFINITY);
    reg.register({ timeBehaviour: clock(40), dispose: () => {} });
    reg.register({ timeBehaviour: clock(7), dispose: () => {} });
    reg.register({ timeBehaviour: clock(Number.POSITIVE_INFINITY), dispose: () => {} });
    expect(reg.minCadenceBudgetS(makeCtx())).toBe(7);
  });

  it('a static layer contributes no budget, however many there are', () => {
    // The point of the required declaration: 'static' is an explicit claim,
    // not the absence of one, and it cannot accidentally read as a budget.
    const reg = new SceneLayerRegistry();
    for (let i = 0; i < 10; i++) {
      reg.register({ timeBehaviour: STATIC, dispose: () => {} });
    }
    expect(reg.minCadenceBudgetS(makeCtx())).toBe(Number.POSITIVE_INFINITY);
    expect(reg.realtimeFramesNeeded(makeCtx())).toBe(false);
  });

  it('a NaN budget cannot win the min — it would freeze the clock', () => {
    // `elapsed >= NaN` is false forever, so a NaN reaching the frame budget
    // would stop the gate ever firing another cadence frame.
    const reg = new SceneLayerRegistry();
    reg.register({ timeBehaviour: clock(Number.NaN), dispose: () => {} });
    reg.register({ timeBehaviour: clock(12), dispose: () => {} });
    expect(reg.minCadenceBudgetS(makeCtx())).toBe(12);
  });

  it('realtimeFramesNeeded is any-of, and a realtime layer sets no budget', () => {
    const reg = new SceneLayerRegistry();
    reg.register({ timeBehaviour: realtime(false), dispose: () => {} });
    expect(reg.realtimeFramesNeeded(makeCtx())).toBe(false);
    reg.register({ timeBehaviour: realtime(true), dispose: () => {} });
    expect(reg.realtimeFramesNeeded(makeCtx())).toBe(true);
    // It asks for every frame instead of a budget, so it must not also
    // silently constrain the cadence.
    expect(reg.minCadenceBudgetS(makeCtx())).toBe(Number.POSITIVE_INFINITY);
  });

  it('behaviourCensus counts each kind — the audit surface', () => {
    const reg = new SceneLayerRegistry();
    reg.register({ timeBehaviour: STATIC, dispose: () => {} });
    reg.register({ timeBehaviour: STATIC, dispose: () => {} });
    reg.register({ timeBehaviour: clock(5), dispose: () => {} });
    reg.register({ timeBehaviour: realtime(false), dispose: () => {} });
    expect(reg.behaviourCensus()).toEqual({ static: 2, clock: 1, realtime: 1 });
  });

  it('passes the shared FrameCtx through to each update', () => {
    const reg = new SceneLayerRegistry();
    const seen: FrameCtx[] = [];
    reg.register({ timeBehaviour: STATIC, update: (ctx) => { seen.push(ctx); }, dispose: () => {} });
    reg.register({ timeBehaviour: STATIC, update: (ctx) => { seen.push(ctx); }, dispose: () => {} });
    const ctx = makeCtx(true);
    reg.updateAll(ctx);
    expect(seen[0]).toBe(ctx);
    expect(seen[1]).toBe(ctx);
    expect(seen[0].warpActive).toBe(true);
  });
});

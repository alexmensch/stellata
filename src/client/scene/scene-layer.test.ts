import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  SceneLayerRegistry,
  type CadenceCtx,
  type FrameCtx,
  type SceneLayer,
} from './scene-layer';
import { makeCadenceCtx } from './frame-ctx-mock';
import {
  CADENCE_REPORT_STILL,
  type CadenceReport,
} from '../render-gate/cadence/clock-cadence-pure';

function makeCtx(warpActive = false): FrameCtx {
  return {
    camera: new THREE.PerspectiveCamera(),
    worldOffset: new THREE.Vector3(),
    distFromSol: 0,
    t: 0,
    warpActive,
  };
}

const STATIC = { kind: 'static' } as const;

function reporting(report: Partial<CadenceReport>): SceneLayer {
  return {
    timeBehaviour: {
      kind: 'clock',
      rate: () => ({ ...CADENCE_REPORT_STILL, ...report }),
    },
    dispose: () => {},
  };
}

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
    reg.register({
      timeBehaviour: STATIC,
      dispose: () => { calls.push('disposeOnly'); },
    });
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

  it('passes the shared FrameCtx through to each update', () => {
    const reg = new SceneLayerRegistry();
    const seen: FrameCtx[] = [];
    reg.register({
      timeBehaviour: STATIC, update: (ctx) => { seen.push(ctx); }, dispose: () => {},
    });
    reg.register({
      timeBehaviour: STATIC, update: (ctx) => { seen.push(ctx); }, dispose: () => {},
    });
    const ctx = makeCtx(true);
    reg.updateAll(ctx);
    expect(seen[0]).toBe(ctx);
    expect(seen[1]).toBe(ctx);
    expect(seen[0].warpActive).toBe(true);
  });
});

describe('SceneLayerRegistry — the cadence reduction', () => {
  const cc = makeCadenceCtx(new THREE.PerspectiveCamera());

  it('a registry of static layers reports nothing moving', () => {
    const reg = new SceneLayerRegistry();
    reg.register({ timeBehaviour: STATIC, dispose: () => {} });
    expect(reg.cadenceReport(cc)).toEqual(CADENCE_REPORT_STILL);
  });

  it('reduces channel-wise, so a slow mover cannot mask a fast one', () => {
    const reg = new SceneLayerRegistry();
    reg.register(reporting({ screenPxPerSimS: 4, fluxFracPerSimS: 0.001 }));
    reg.register(reporting({ screenPxPerSimS: 0.5, fluxFracPerSimS: 0.02 }));
    expect(reg.cadenceReport(cc)).toEqual({
      screenPxPerSimS: 4,
      fluxFracPerSimS: 0.02,
      observedPx: 0,
      observedFluxFrac: 0,
    });
  });

  it('a NaN rate cannot win the reduction and freeze the clock', () => {
    const reg = new SceneLayerRegistry();
    reg.register(reporting({ screenPxPerSimS: 3 }));
    reg.register(reporting({ screenPxPerSimS: Number.NaN }));
    expect(reg.cadenceReport(cc).screenPxPerSimS).toBe(3);
  });

  it('NaN alone still reduces to zero rather than to NaN', () => {
    const reg = new SceneLayerRegistry();
    reg.register(reporting({ screenPxPerSimS: Number.NaN, fluxFracPerSimS: Number.NaN }));
    expect(reg.cadenceReport(cc)).toEqual(CADENCE_REPORT_STILL);
  });

  it('the observed channels reduce alongside the rates', () => {
    const reg = new SceneLayerRegistry();
    reg.register(reporting({ observedPx: 0.1, observedFluxFrac: 0.4 }));
    reg.register(reporting({ observedPx: 0.9, observedFluxFrac: 0.2 }));
    const out = reg.cadenceReport(cc);
    expect(out.observedPx).toBe(0.9);
    expect(out.observedFluxFrac).toBe(0.4);
  });

  it('every clock layer is asked, and asked with the shared ctx', () => {
    const reg = new SceneLayerRegistry();
    const seen: CadenceCtx[] = [];
    for (let i = 0; i < 3; i++) {
      reg.register({
        timeBehaviour: {
          kind: 'clock',
          rate: (ctx) => { seen.push(ctx); return CADENCE_REPORT_STILL; },
        },
        dispose: () => {},
      });
    }
    reg.cadenceReport(cc);
    expect(seen).toEqual([cc, cc, cc]);
  });

  it('census counts each declared behaviour', () => {
    const reg = new SceneLayerRegistry();
    reg.register({ timeBehaviour: STATIC, dispose: () => {} });
    reg.register(reporting({}));
    reg.register({
      timeBehaviour: { kind: 'realtime', needsFrames: () => false },
      dispose: () => {},
    });
    expect(reg.behaviourCensus()).toEqual({ static: 1, clock: 1, realtime: 1 });
  });

  it('realtimeFramesNeeded is any-of over the realtime predicates', () => {
    const reg = new SceneLayerRegistry();
    const fc = makeCtx();
    reg.register({
      timeBehaviour: { kind: 'realtime', needsFrames: () => false },
      dispose: () => {},
    });
    expect(reg.realtimeFramesNeeded(fc)).toBe(false);
    reg.register({
      timeBehaviour: { kind: 'realtime', needsFrames: () => true },
      dispose: () => {},
    });
    expect(reg.realtimeFramesNeeded(fc)).toBe(true);
  });
});

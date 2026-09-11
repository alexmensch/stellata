import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  SceneLayerRegistry,
  type CadenceCtx,
  type ContributionSkip,
  type FrameCtx,
  type LayerTimeBehaviour,
  type SceneLayer,
} from './scene-layer';
import { makeCadenceCtx, makeFrameCtx } from './frame-ctx-mock';
import {
  CADENCE_REPORT_STILL,
  type CadenceReport,
} from '../render-gate/cadence/clock-cadence-pure';

function makeCtx(warpActive = false): FrameCtx {
  return makeFrameCtx(new THREE.PerspectiveCamera(), { warpActive });
}

const STATIC = { kind: 'static' } as const;
const ALWAYS = { kind: 'always' } as const;

function reporting(report: Partial<CadenceReport>): SceneLayer {
  return {
    timeBehaviour: {
      kind: 'clock',
      rate: () => ({ ...CADENCE_REPORT_STILL, ...report }),
    },
    contribution: ALWAYS,
    dispose: () => {},
  };
}

/** A gated layer whose verdict the test scripts per call, recording every
 *  `update` and `setContributing` it receives. */
function gated(
  verdicts: (ContributionSkip | null)[],
  timeBehaviour: LayerTimeBehaviour = STATIC,
) {
  const calls: string[] = [];
  let n = 0;
  const layer: SceneLayer = {
    timeBehaviour,
    contribution: {
      kind: 'gated',
      skip: () => verdicts[Math.min(n++, verdicts.length - 1)],
      setContributing: (on) => { calls.push(`contributing:${on}`); },
    },
    update: () => { calls.push('update'); },
    setMonochrome: (on) => { calls.push(`mono:${on}`); },
    recenter: (o) => { calls.push(`recenter:${o.x}`); },
    dispose: () => { calls.push('dispose'); },
  };
  return { layer, calls };
}

describe('SceneLayerRegistry', () => {
  it('updateAll runs every registered update hook in registration order', () => {
    const reg = new SceneLayerRegistry();
    const order: string[] = [];
    const layer = (name: string): SceneLayer => ({
      timeBehaviour: STATIC,
      contribution: ALWAYS,
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
      contribution: ALWAYS,
      dispose: () => { calls.push('disposeOnly'); },
    });
    reg.register({
      timeBehaviour: STATIC,
      contribution: ALWAYS,
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
      reg.register({
        timeBehaviour: STATIC, contribution: ALWAYS, dispose: () => { disposed.add(i); },
      });
    }
    reg.disposeAll();
    expect(disposed.size).toBe(5);
  });

  it('passes the shared FrameCtx through to each update', () => {
    const reg = new SceneLayerRegistry();
    const seen: FrameCtx[] = [];
    reg.register({
      timeBehaviour: STATIC, contribution: ALWAYS,
      update: (ctx) => { seen.push(ctx); }, dispose: () => {},
    });
    reg.register({
      timeBehaviour: STATIC, contribution: ALWAYS,
      update: (ctx) => { seen.push(ctx); }, dispose: () => {},
    });
    const ctx = makeCtx(true);
    reg.updateAll(ctx);
    expect(seen[0]).toBe(ctx);
    expect(seen[1]).toBe(ctx);
    expect(seen[0].warpActive).toBe(true);
  });
});

describe('SceneLayerRegistry — contribution gating', () => {
  it('a skipping layer gets no update; its always-on neighbours still do', () => {
    const reg = new SceneLayerRegistry();
    const order: string[] = [];
    reg.register({
      timeBehaviour: STATIC, contribution: ALWAYS,
      update: () => { order.push('a'); }, dispose: () => {},
    });
    const g = gated(['legibility']);
    reg.register(g.layer);
    reg.register({
      timeBehaviour: STATIC, contribution: ALWAYS,
      update: () => { order.push('c'); }, dispose: () => {},
    });
    reg.updateAll(makeCtx());
    expect(order).toEqual(['a', 'c']);
    expect(g.calls).toEqual(['contributing:false']);
  });

  it('setContributing fires on transitions only — a layer that stays skipped pays the predicate alone', () => {
    const reg = new SceneLayerRegistry();
    const g = gated(['frustum', 'frustum', null, null, 'opacity']);
    reg.register(g.layer);
    const ctx = makeCtx();
    for (let i = 0; i < 5; i++) reg.updateAll(ctx);
    expect(g.calls).toEqual([
      'contributing:false',
      'contributing:true', 'update',
      'update',
      'contributing:false',
    ]);
  });

  it('a layer that draws from its first frame is never told so — its constructed visibility stands', () => {
    const reg = new SceneLayerRegistry();
    const g = gated([null]);
    reg.register(g.layer);
    reg.updateAll(makeCtx());
    reg.updateAll(makeCtx());
    expect(g.calls).toEqual(['update', 'update']);
  });

  it('a skipped layer still receives monochrome, recentre and dispose', () => {
    const reg = new SceneLayerRegistry();
    const g = gated(['frustum']);
    reg.register(g.layer);
    reg.updateAll(makeCtx());
    reg.setMonochromeAll(true);
    reg.recenterAll(new THREE.Vector3(3, 0, 0));
    reg.disposeAll();
    expect(g.calls).toEqual(['contributing:false', 'mono:true', 'recenter:3', 'dispose']);
  });

  it('the skip predicate sees the shared FrameCtx', () => {
    const reg = new SceneLayerRegistry();
    let seen: FrameCtx | null = null;
    reg.register({
      timeBehaviour: STATIC,
      contribution: {
        kind: 'gated',
        skip: (ctx) => { seen = ctx; return null; },
        setContributing: () => {},
      },
      dispose: () => {},
    });
    const ctx = makeCtx();
    reg.updateAll(ctx);
    expect(seen).toBe(ctx);
  });

  it('census counts each kind and every live skip by reason', () => {
    const reg = new SceneLayerRegistry();
    reg.register({ timeBehaviour: STATIC, contribution: ALWAYS, dispose: () => {} });
    reg.register(gated(['frustum']).layer);
    reg.register(gated(['frustum']).layer);
    reg.register(gated(['legibility']).layer);
    reg.register(gated([null]).layer);
    reg.updateAll(makeCtx());
    expect(reg.contributionCensus()).toEqual({
      always: 1,
      gated: 4,
      skipped: { frustum: 2, legibility: 1, opacity: 0 },
    });
  });

  it('a throwing skip predicate is collected like a throwing update, and its siblings still run', () => {
    const reg = new SceneLayerRegistry();
    const order: string[] = [];
    reg.register({
      timeBehaviour: STATIC,
      contribution: { kind: 'gated', skip: () => { throw new Error('boom'); }, setContributing: () => {} },
      update: () => { order.push('broken'); },
      dispose: () => {},
    });
    reg.register({
      timeBehaviour: STATIC, contribution: ALWAYS,
      update: () => { order.push('b'); }, dispose: () => {},
    });
    expect(() => reg.updateAll(makeCtx())).toThrow(AggregateError);
    expect(order).toEqual(['b']);
  });

  it('a skipped clock layer is left out of the frame rate — its update never ran', () => {
    const reg = new SceneLayerRegistry();
    const moving: CadenceReport = { ...CADENCE_REPORT_STILL, screenPxPerSimS: 100 };
    const g = gated(['frustum'], { kind: 'clock', rate: () => moving });
    reg.register(g.layer);
    reg.updateAll(makeCtx());
    expect(reg.cadenceReport(makeCadenceCtx(new THREE.PerspectiveCamera())))
      .toEqual(CADENCE_REPORT_STILL);
  });

  it('the same layer binds the budget again on the frame it returns', () => {
    const reg = new SceneLayerRegistry();
    const moving: CadenceReport = { ...CADENCE_REPORT_STILL, screenPxPerSimS: 100 };
    const g = gated(['frustum', null], { kind: 'clock', rate: () => moving });
    reg.register(g.layer);
    const cc = makeCadenceCtx(new THREE.PerspectiveCamera());
    reg.updateAll(makeCtx());
    expect(reg.cadenceReport(cc).screenPxPerSimS).toBe(0);
    reg.updateAll(makeCtx());
    expect(reg.cadenceReport(cc).screenPxPerSimS).toBe(100);
  });

  it('a skipped realtime layer stops defeating idling', () => {
    const reg = new SceneLayerRegistry();
    const g = gated(['opacity'], { kind: 'realtime', needsFrames: () => true });
    reg.register(g.layer);
    const fc = makeCtx();
    expect(reg.realtimeFramesNeeded(fc)).toBe(true);
    reg.updateAll(fc);
    expect(reg.realtimeFramesNeeded(fc)).toBe(false);
  });

  it('disposeAll resets the skip state, so a census after teardown reads clean', () => {
    const reg = new SceneLayerRegistry();
    const g = gated(['opacity']);
    reg.register(g.layer);
    reg.updateAll(makeCtx());
    expect(reg.contributionCensus().skipped.opacity).toBe(1);
    reg.disposeAll();
    expect(reg.contributionCensus().skipped.opacity).toBe(0);
  });
});

describe('SceneLayerRegistry — the cadence reduction', () => {
  const cc = makeCadenceCtx(new THREE.PerspectiveCamera());

  it('a registry of static layers reports nothing moving', () => {
    const reg = new SceneLayerRegistry();
    reg.register({ timeBehaviour: STATIC, contribution: ALWAYS, dispose: () => {} });
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
        contribution: ALWAYS,
        dispose: () => {},
      });
    }
    reg.cadenceReport(cc);
    expect(seen).toEqual([cc, cc, cc]);
  });

  it('census counts each declared behaviour', () => {
    const reg = new SceneLayerRegistry();
    reg.register({ timeBehaviour: STATIC, contribution: ALWAYS, dispose: () => {} });
    reg.register(reporting({}));
    reg.register({
      timeBehaviour: { kind: 'realtime', needsFrames: () => false },
      contribution: ALWAYS,
      dispose: () => {},
    });
    expect(reg.behaviourCensus()).toEqual({ static: 1, clock: 1, realtime: 1 });
  });

  it('realtimeFramesNeeded is any-of over the realtime predicates', () => {
    const reg = new SceneLayerRegistry();
    const fc = makeCtx();
    reg.register({
      timeBehaviour: { kind: 'realtime', needsFrames: () => false },
      contribution: ALWAYS,
      dispose: () => {},
    });
    expect(reg.realtimeFramesNeeded(fc)).toBe(false);
    reg.register({
      timeBehaviour: { kind: 'realtime', needsFrames: () => true },
      contribution: ALWAYS,
      dispose: () => {},
    });
    expect(reg.realtimeFramesNeeded(fc)).toBe(true);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { NO_INSTANCE } from '../../frame/shared-uniforms';
import { tToJdUt, VirtualClock } from '../../solar-system/time/time';
import { J2000_JD } from '../../util/astronomy-constants';
import type { FrameCtx } from '../scene-layer';
import { FrameLoop, type FrameLoopDeps } from './frame-loop';

interface Knobs {
  render: boolean;
  animating: boolean;
  realtime: boolean;
  epochStep: boolean;
  recentred: boolean;
  pinnedStar: number | null;
  focusedStar: number | null;
}

const FIXED_CLOCK = {
  getT: () => 946_728_000, getRate: () => 86_400, inFrame: <T>(fn: () => T): T => fn(),
};

function harness(overrides: Partial<Knobs> = {}, clock: FrameLoopDeps['clock'] = FIXED_CLOCK) {
  const knobs: Knobs = {
    render: true, animating: false, realtime: false, epochStep: false,
    recentred: false, pinnedStar: null, focusedStar: 7, ...overrides,
  };
  const log: string[] = [];
  const note = (name: string) => () => { log.push(name); };
  const camera = new THREE.PerspectiveCamera(50, 1, 1e-6, 1e6);
  camera.position.set(1, 2, 2);
  const worldOffset = new THREE.Vector3(3, 4, 12);
  const scene = new THREE.Scene();
  const uniforms = {
    uCameraPos: { value: new THREE.Vector3() },
    uPinFocusToCenter: { value: 99 },
    uModelDays: { value: 0 },
    uModelDaysPerRealSec: { value: 0 },
    uPixelRatio: { value: 2 },
  };
  const gateInputs: { continuous: boolean; cadenceDue: boolean }[] = [];
  const ctxs: FrameCtx[] = [];
  const reads: Record<string, number> = {};
  const renderer = { render: note('render') };
  const deps = {
    scene,
    camera,
    orbitTarget: new THREE.Vector3(),
    webgpu: { renderer, timestampsAvailable: false, syncUniformNodes: note('syncUniformNodes') },
    hdr: { bind: note('hdr.bind'), resolve: note('hdr.resolve') },
    uniforms,
    clock,
    origin: {
      worldOffset,
      tick: () => { log.push('origin.tick'); return knobs.recentred; },
    },
    starFrame: {
      advanceEpochTo: (t: number, _focal: number | null, out: THREE.Vector3) => {
        log.push('advanceEpochTo');
        reads.epoch = t;
        if (knobs.epochStep) out.set(0.5, 0, 0);
        return knobs.epochStep;
      },
      flushLocalPositions: note('flushLocalPositions'),
      syncPhysSizeWindow: note('syncPhysSizeWindow'),
    },
    focalRides: {
      reseedMoving: note('reseedMoving'),
      followEpochStep: (d: Readonly<THREE.Vector3>) => { log.push(`followEpochStep:${d.x}`); },
    },
    cameraStep: { advance: () => { log.push('cameraStep'); return knobs.animating; } },
    focus: {
      getFocusedStar: () => knobs.focusedStar,
      pinnedStar: () => knobs.pinnedStar,
    },
    warp: { isActive: () => true },
    layers: {
      realtimeFramesNeeded: () => { log.push('realtime?'); return knobs.realtime; },
      updateAll: (ctx: FrameCtx) => {
        log.push('updateAll');
        ctxs.push({ ...ctx });
        reads.layer = clock.getT();
      },
    },
    cadence: {
      isDue: () => false,
      refresh: note('cadence.refresh'),
    },
    renderGate: {
      tick: (_c: unknown, _t: unknown, _w: unknown, inputs: { continuous: boolean; cadenceDue: boolean }) => {
        log.push('gate');
        gateInputs.push(inputs);
        return knobs.render;
      },
      invalidate: (reason: string) => { log.push(`invalidate:${reason}`); },
      lastFrameWasCadenceScheduled: false,
    },
    occluders: { beginFrame: note('occluders.beginFrame') },
    extinction: { update: note('extinction.update'), refreshPositions: note('extinction.refreshPositions') },
    exposureFrame: {
      frameExposure: () => null,
      measure: () => { log.push('measure'); return false; },
      reduce: note('reduce'),
    },
    starPipeline: { update: note('starPipeline.update') },
    localDepthPass: { render: note('localDepth.render') },
    pxPerRadian: () => 1234,
    emitFrame: () => { log.push('emitFrame'); reads.frameEvent = clock.getT(); },
  } as unknown as FrameLoopDeps;
  const loop = new FrameLoop(deps);
  return { loop, log, knobs, uniforms, gateInputs, ctxs, scene, deps, reads };
}

let scheduled: FrameRequestCallback[] = [];

beforeEach(() => {
  scheduled = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    scheduled.push(cb);
    return scheduled.length;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function runNext(): void {
  const cb = scheduled.shift();
  if (!cb) throw new Error('no frame scheduled');
  cb(0);
}

describe('FrameLoop tick', () => {
  it('runs a rendered tick in the documented order and schedules the next', () => {
    const { loop, log } = harness();
    loop.start();
    expect(log).toEqual([
      'advanceEpochTo', 'origin.tick', 'flushLocalPositions', 'cameraStep', 'realtime?', 'gate',
      'occluders.beginFrame', 'updateAll', 'extinction.update', 'cadence.refresh', 'measure',
      'hdr.bind', 'syncPhysSizeWindow', 'syncUniformNodes', 'starPipeline.update', 'render',
      'localDepth.render', 'hdr.resolve', 'reduce', 'emitFrame',
    ]);
    expect(scheduled).toHaveLength(1);
  });

  it('a refused tick stops at the gate and still schedules the next', () => {
    const { loop, log } = harness({ render: false });
    loop.start();
    expect(log).toEqual([
      'advanceEpochTo', 'origin.tick', 'flushLocalPositions', 'cameraStep', 'realtime?', 'gate',
    ]);
    expect(scheduled).toHaveLength(1);
  });

  it.each([
    [false, false, false],
    [true, false, true],
    [false, true, true],
  ])('animating %s, realtime %s → continuous %s', (animating, realtime, continuous) => {
    const { loop, gateInputs } = harness({ animating, realtime });
    loop.start();
    expect(gateInputs[0].continuous).toBe(continuous);
    expect(loop.realtimeFramesNeeded).toBe(realtime);
  });

  it('builds the frame context before the gate, with Sol distance summed across the origin', () => {
    const { loop, ctxs } = harness();
    loop.start();
    expect(ctxs[0]).toMatchObject({
      distFromSol: Math.hypot(4, 6, 14),
      t: 946_728_000,
      warpActive: true,
      pxPerRadian: 1234,
      exposure: null,
    });
  });

  it('writes the per-frame uniforms', () => {
    const { loop, uniforms } = harness({ pinnedStar: 7 });
    loop.start();
    expect(uniforms.uPinFocusToCenter.value).toBe(7);
    expect(uniforms.uModelDays.value).toBeCloseTo(0, 6);
    expect(uniforms.uModelDaysPerRealSec.value).toBe(1);
    expect(uniforms.uCameraPos.value.toArray()).toEqual([1, 2, 2]);
  });

  it('writes the disabled pin sentinel when the pin is not engaged', () => {
    const { loop, uniforms } = harness({ pinnedStar: null });
    loop.start();
    expect(uniforms.uPinFocusToCenter.value).toBe(NO_INSTANCE);
  });

  it('an epoch step invalidates, refreshes extinction and hands the follow its delta', () => {
    const { loop, log } = harness({ epochStep: true, render: false });
    loop.start();
    expect(log.slice(0, 4)).toEqual([
      'advanceEpochTo', 'invalidate:epoch-bucket', 'extinction.refreshPositions', 'followEpochStep:0.5',
    ]);
  });

  it('a recentre reseeds the moving-focal ride', () => {
    const { loop, log } = harness({ recentred: true, render: false });
    loop.start();
    expect(log).toContain('reseedMoving');
  });
});

describe('FrameLoop — one sim instant per tick', () => {
  const T0 = 946_728_000;
  // A millisecond of wall time between reads is ~50 sim days at this rate.
  function steppingClock(): VirtualClock {
    let wall = 1_000;
    const clock = new VirtualClock(() => (wall += 1e-3));
    clock.setRate(2 ** 32);
    clock.setTimeAbsolute(T0);
    return clock;
  }

  it('the epoch step, FrameCtx.t, uModelDays and every reader in the tick agree', () => {
    const clock = steppingClock();
    const { loop, ctxs, uniforms, reads } = harness({}, clock);
    loop.start();
    const t = ctxs[0].t;
    expect(reads).toEqual({ epoch: t, layer: t, frameEvent: t });
    expect(uniforms.uModelDays.value).toBe(tToJdUt(t) - J2000_JD);
  });

  it('releases the clock after a rendered tick and after a refused one', () => {
    for (const render of [true, false]) {
      const clock = steppingClock();
      const { loop, reads } = harness({ render }, clock);
      loop.start();
      expect(clock.getT()).toBeGreaterThan(reads.epoch);
    }
  });
});

describe('FrameLoop GLSL residents check', () => {
  it('reports a raw ShaderMaterial on the first rendered frame only', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { loop, scene } = harness();
    scene.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial()));
    loop.start();
    runNext();
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('FrameLoop lastCameraWriteEntry', () => {
  it('runs the write, then leaves the frustum valid for the readers below', () => {
    const { loop, deps } = harness();
    const entry = loop.lastCameraWriteEntry(() => { deps.camera.position.set(9, 9, 9); });
    let validBefore = true;
    let validAfter = false;
    (deps.layers as { updateAll: (ctx: FrameCtx) => void }).updateAll = (ctx) => {
      validBefore = ctx.frustum.isValid;
      entry.update!(ctx);
      validAfter = ctx.frustum.isValid;
    };
    loop.start();
    expect(validBefore).toBe(false);
    expect(validAfter).toBe(true);
    expect(deps.camera.position.toArray()).toEqual([9, 9, 9]);
  });
});

describe('FrameLoop dispose', () => {
  it('stops the loop, clears the realtime verdict and invalidates the frustum', () => {
    const { loop, log, deps } = harness({ realtime: true });
    const entry = loop.lastCameraWriteEntry(() => {});
    let ctx: FrameCtx | null = null;
    (deps.layers as { updateAll: (c: FrameCtx) => void }).updateAll = (c) => {
      ctx = c;
      entry.update!(c);
    };
    loop.start();
    loop.dispose();
    expect(loop.realtimeFramesNeeded).toBe(false);
    expect(ctx!.frustum.isValid).toBe(false);
    log.length = 0;
    runNext();
    expect(log).toEqual([]);
    expect(scheduled).toHaveLength(0);
  });
});

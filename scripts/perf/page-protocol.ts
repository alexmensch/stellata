// Every page.evaluate the runner makes — boot, settle snapshot, adapter
// probe, rAF probe, the priceFrame call. Node-side orchestration is run.ts.

import type { BrowserContext, Page } from 'playwright';
import type { DebugTools } from '../../src/client/debug/debug';
import type {
  PassToggle, PriceFrameOptions, PriceFrameRow,
} from '../../src/client/debug/frame-cost/frame-cost';
import type { Stellata } from '../../src/client/stellata';
import type { PassCounter } from './dwell-pure';
import type { AdapterProbe, WebGlProbe, WebGpuProbe } from './schema';
import type { Backend } from './scenarios';
import { settleVerdict, type GateSnapshot } from './settle-pure';

interface PerfWindow {
  readonly debug: DebugTools;
  readonly stellata: Stellata;
}

export class BootError extends Error {}
export class SettleTimeout extends Error {}

export const DISMISSAL_SEEDS = {
  localStorage: { 'stellata.info-dismissed': '1' },
  sessionStorage: { 'stellata.mobile-advisory-dismissed': '1' },
} as const;

export async function seedDismissals(context: BrowserContext): Promise<void> {
  await context.addInitScript((seeds) => {
    for (const [k, v] of Object.entries(seeds.localStorage)) localStorage.setItem(k, v);
    for (const [k, v] of Object.entries(seeds.sessionStorage)) sessionStorage.setItem(k, v);
  }, DISMISSAL_SEEDS);
}

export interface BootOptions {
  readonly backend: Backend;
  readonly timeoutMs: number;
}

export async function bootScenario(page: Page, url: string, { backend, timeoutMs }: BootOptions): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  const outcome = await page.waitForFunction(() => {
    const status = document.getElementById('loading-status')?.textContent ?? '';
    if (status.startsWith('Error:')) return status;
    const w = window as unknown as Partial<PerfWindow>;
    const booted = document.getElementById('loading') === null && w.debug !== undefined && w.stellata !== undefined;
    return booted ? 'ok' : null;
  }, undefined, { timeout: timeoutMs, polling: 250 });
  const text = (await outcome.jsonValue()) as string;
  if (text !== 'ok') throw new BootError(text);

  const actual = await page.evaluate(() =>
    ((window as unknown as PerfWindow).stellata.webgpu === null ? 'webgl2' : 'webgpu'));
  if (actual !== backend) {
    throw new BootError(
      `requested the ${backend} boot but the page booted ${actual}` +
      (backend === 'webgpu' ? ' — a silent fallback is a failed scenario, never a mislabelled one' : ''),
    );
  }
}

export function readGateSnapshot(page: Page): Promise<GateSnapshot> {
  return page.evaluate(() => {
    const s = (window as unknown as PerfWindow).stellata;
    const gate = s.renderGate.debugState;
    return {
      now: performance.now(),
      holds: gate.holds,
      lastActiveMs: gate.lastActiveMs,
      lastWakeReason: gate.lastWake?.reason ?? null,
      transition: s.isCameraTransitionActive(),
    };
  });
}

export interface SettleOptions {
  readonly quietMs: number;
  readonly timeoutMs: number;
  readonly pollMs?: number;
}

export async function awaitSettle(page: Page, { quietMs, timeoutMs, pollMs = 250 }: SettleOptions): Promise<number> {
  const started = Date.now();
  for (;;) {
    const verdict = settleVerdict(await readGateSnapshot(page), quietMs);
    if (verdict.settled) return Date.now() - started;
    if (Date.now() - started > timeoutMs) {
      throw new SettleTimeout(`not settled after ${timeoutMs} ms — stuck on ${verdict.stuckOn}: ${verdict.detail}`);
    }
    await page.waitForTimeout(pollMs);
  }
}

export function probeAdapters(page: Page): Promise<AdapterProbe> {
  return page.evaluate(async () => {
    const s = (window as unknown as PerfWindow).stellata;
    const live = s.rendererGL?.getContext() as WebGL2RenderingContext | undefined;
    const gl = (live ?? document.createElement('canvas').getContext('webgl2')) as WebGL2RenderingContext | null;
    let webgl: WebGlProbe | null = null;
    if (gl !== null) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      webgl = {
        renderer: String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
        vendor: String(gl.getParameter(info ? info.UNMASKED_VENDOR_WEBGL : gl.VENDOR)),
        timerQuery: gl.getExtension('EXT_disjoint_timer_query_webgl2') !== null,
      };
      // A WebGPU boot has no live GL context, so this probe made one. Drop it
      // before the sweep: the instrument must not leave a second GPU context
      // alive in the page whose frame it is about to price.
      if (live === undefined) gl.getExtension('WEBGL_lose_context')?.loseContext();
    }

    type AdapterLike = { readonly info?: Record<string, unknown>; readonly isFallbackAdapter?: boolean };
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<AdapterLike | null> } }).gpu;
    const adapter = gpu ? await gpu.requestAdapter() : null;
    let webgpu: WebGpuProbe | null = null;
    if (adapter !== null) {
      const info = adapter.info ?? {};
      webgpu = {
        vendor: String(info.vendor ?? ''),
        architecture: String(info.architecture ?? ''),
        device: String(info.device ?? ''),
        description: String(info.description ?? ''),
        isFallbackAdapter: Boolean(info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? false),
        timestampsAvailable: s.webgpu?.timestampsAvailable ?? null,
      };
    }
    return { webgl, webgpu };
  });
}

// Page functions hold no inner named helpers: tsx wraps those in a `__name`
// call that does not exist once Playwright serialises the body into the page.
export function probeRafDeltas(page: Page, frames: number): Promise<number[]> {
  return page.evaluate(async (count) => {
    let last = await new Promise<number>((r) => requestAnimationFrame(r));
    const deltas: number[] = [];
    for (let i = 0; i < count; i++) {
      const now = await new Promise<number>((r) => requestAnimationFrame(r));
      deltas.push(now - last);
      last = now;
    }
    return deltas;
  }, frames);
}

export function readDrawingBuffer(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => {
    const canvas = (window as unknown as PerfWindow).stellata.renderer.domElement;
    return { width: canvas.width, height: canvas.height };
  });
}

export function runDifferential(page: Page, options: PriceFrameOptions): Promise<PriceFrameRow[]> {
  return page.evaluate((o) => (window as unknown as PerfWindow).debug.priceFrame(o), options);
}

export interface DwellParams {
  readonly frames: number;
  readonly warmupFrames: number;
  /** Subscribe the WebGPU frame-sample stream alongside the rAF deltas.
   *  Only a WebGPU boot has one, and nothing there is exclusive — the
   *  render loop resolves for whoever is listening. */
  readonly wantGpuStream: boolean;
  /** Where the dev server serves the sample module from. The stream has no
   *  window surface, so the dwell reaches it through the module graph. */
  readonly samplesModuleUrl: string;
  /** Count queue submits, command buffers and encoded passes per timed
   *  frame by wrapping the WebGPU prototypes for the dwell's duration. */
  readonly countPasses: boolean;
}

export interface DwellRaw {
  readonly deltasMs: number[];
  readonly gpuMs: number[];
  readonly gpuNote: string;
  readonly passCounts: Record<PassCounter, number[]> | null;
  readonly passNote: string;
  readonly readbackPerFrame: number;
  readonly effectiveLimitMag: number;
  readonly dm: number;
  readonly rateBefore: number;
  /** The rate the timed frames actually ran at, sampled before the restore.
   *  Zero unless something outside the dwell moved the clock mid-measurement. */
  readonly rateDuring: number;
  /** Holds live before the dwell took its own, so a hold the page already
   *  owned (an open debug panel takes one) does not read as a leak. */
  readonly holdsBefore: number;
}

/**
 * Dwell on the live frame under a render-gate hold, with the simulation
 * clock stopped and the exposure pinned where the warmup left it — the
 * same three preconditions the in-app differential establishes, for the
 * same reasons (`src/client/debug/frame-cost/README.md` § Preconditions).
 *
 * rAF deltas are the primary metric because they are the one clock every
 * backend supplies. The WebGPU timestamp stream rides alongside where it
 * is sound, as a second opinion on the same frames rather than a
 * replacement: the two are different instruments and are never
 * differenced against each other.
 *
 * The pass counts wrap `GPUQueue.submit` and the two `GPUCommandEncoder`
 * begin-pass methods on their prototypes for the timed frames only, and
 * put the originals back in the same `finally` as the other restores.
 * Prototype members are assigned rather than declared as helpers because
 * tsx wraps a named inner function in `__name`, which does not exist once
 * the body is serialised into the page.
 */
export function runDwell(page: Page, params: DwellParams): Promise<DwellRaw> {
  return page.evaluate(async (p) => {
    const s = (window as unknown as PerfWindow).stellata;
    const gpuMs: number[] = [];
    let stopGpu: (() => void) | null = null;
    let gpuNote = 'not requested — rAF wall-clock deltas are the metric';

    type Proto = Record<string, unknown>;
    const g = globalThis as unknown as Record<string, { prototype: Proto } | undefined>;
    const queueProto = g.GPUQueue?.prototype;
    const encoderProto = g.GPUCommandEncoder?.prototype;
    const live = { submits: 0, commandBuffers: 0, renderPasses: 0, computePasses: 0 };
    const perFrame: Record<PassCounter, number[]> | null = p.countPasses
      ? { submits: [], commandBuffers: [], renderPasses: [], computePasses: [] }
      : null;
    let passNote = 'not requested — a WebGL2 boot has no queue to count on';
    let origSubmit: unknown = null;
    let origRenderPass: unknown = null;
    let origComputePass: unknown = null;
    if (perFrame !== null) {
      if (queueProto !== undefined && encoderProto !== undefined) {
        origSubmit = queueProto.submit;
        origRenderPass = encoderProto.beginRenderPass;
        origComputePass = encoderProto.beginComputePass;
        const submit = origSubmit as (this: unknown, b: readonly unknown[]) => void;
        const renderPass = origRenderPass as (this: unknown, d: unknown) => unknown;
        const computePass = origComputePass as (this: unknown, d?: unknown) => unknown;
        queueProto.submit = function (this: unknown, buffers: readonly unknown[]) {
          live.submits += 1;
          live.commandBuffers += buffers.length;
          return submit.call(this, buffers);
        };
        encoderProto.beginRenderPass = function (this: unknown, descriptor: unknown) {
          live.renderPasses += 1;
          return renderPass.call(this, descriptor);
        };
        encoderProto.beginComputePass = function (this: unknown, descriptor?: unknown) {
          live.computePasses += 1;
          return computePass.call(this, descriptor);
        };
        passNote = 'counted on GPUQueue.submit and GPUCommandEncoder.beginRenderPass/beginComputePass';
      } else {
        passNote = 'no GPUQueue / GPUCommandEncoder prototype on this page';
      }
    }

    if (p.wantGpuStream) {
      try {
        const samples = await import(p.samplesModuleUrl) as {
          gpuFrameSamplesAreSound(): boolean;
          onGpuFrameSample(fn: (ms: number) => void): () => void;
        };
        if (samples.gpuFrameSamplesAreSound()) {
          stopGpu = samples.onGpuFrameSample((ms) => gpuMs.push(ms));
          gpuNote = 'subscribed';
        } else {
          gpuNote = 'timestamp-query granted but resolving durations no frame can have';
        }
      } catch (e) {
        gpuNote = `${p.samplesModuleUrl} did not load (${(e as Error).message})`;
      }
    }

    const clock = s.timeClock;
    const rateBefore = clock.getRate();
    const holdsBefore = s.renderGate.debugState.holds;
    const releaseHold = s.renderGate.hold();
    const deltasMs: number[] = [];
    let readbacks = 0;
    let effectiveLimitMag = 0;
    let dm = 0;
    // Sampled before the finally restores. A rate read back after the same
    // block wrote it could only ever fail if setRate itself refused; read
    // here it answers the question worth asking — did anything move the
    // clock while the frames being timed were drawn.
    let rateDuring = 0;
    try {
      if (rateBefore !== 0) clock.setRate(0);
      for (let f = 0; f < p.warmupFrames; f++) {
        await new Promise((r) => requestAnimationFrame(r));
      }
      s.adaptation.setHeld(true);
      dm = s.adaptation.getDm();
      gpuMs.length = 0;
      const readbacksBefore = s.reduction.readbackRequests;
      let last = await new Promise<number>((r) => requestAnimationFrame(r));
      live.submits = 0;
      live.commandBuffers = 0;
      live.renderPasses = 0;
      live.computePasses = 0;
      for (let f = 0; f < p.frames; f++) {
        const now = await new Promise<number>((r) => requestAnimationFrame(r));
        deltasMs.push(now - last);
        last = now;
        if (perFrame !== null) {
          perFrame.submits.push(live.submits);
          perFrame.commandBuffers.push(live.commandBuffers);
          perFrame.renderPasses.push(live.renderPasses);
          perFrame.computePasses.push(live.computePasses);
          live.submits = 0;
          live.commandBuffers = 0;
          live.renderPasses = 0;
          live.computePasses = 0;
        }
      }
      readbacks = s.reduction.readbackRequests - readbacksBefore;
      effectiveLimitMag = s.exposure.getEffectiveLimitMag();
    } finally {
      rateDuring = clock.getRate();
      stopGpu?.();
      if (origSubmit !== null && queueProto !== undefined && encoderProto !== undefined) {
        queueProto.submit = origSubmit;
        encoderProto.beginRenderPass = origRenderPass;
        encoderProto.beginComputePass = origComputePass;
      }
      s.adaptation.setHeld(false);
      if (rateDuring !== rateBefore) clock.setRate(rateBefore);
      releaseHold();
    }

    return {
      deltasMs,
      gpuMs,
      gpuNote,
      passCounts: origSubmit !== null ? perFrame : null,
      passNote,
      readbackPerFrame: p.frames > 0 ? readbacks / p.frames : 0,
      effectiveLimitMag,
      dm,
      rateBefore,
      rateDuring,
      holdsBefore,
    };
  }, params);
}

export interface RoundTripParams {
  /** A priceFrame pass key, or the idle sentinel the caller passes through
   *  for the time-matched control. */
  readonly pass: string;
  readonly idleKey: string;
  readonly offFrames: number;
  readonly settleFrames: number;
  /** Where the dev server serves the frame-cost module from: the pass
   *  roster is `buildPassToggles`, reached through the module graph. */
  readonly toggleModuleUrl: string;
}

/**
 * Between two dwells: hold the render gate, stop the clock and pin the
 * exposure exactly as priceFrame does around its own disabled dwell, apply
 * the pass's own toggle, render `offFrames`, restore it, render
 * `settleFrames`, and put every precondition back. The idle key does the
 * same frames with nothing toggled. Throws if the pass is not in the
 * roster or not active at this vantage — a round trip of nothing is not a
 * control, it is the idle case wearing a pass's name.
 */
export function runRoundTrip(page: Page, params: RoundTripParams): Promise<void> {
  return page.evaluate(async (p) => {
    const s = (window as unknown as PerfWindow).stellata;
    const clock = s.timeClock;
    const rateBefore = clock.getRate();
    const releaseHold = s.renderGate.hold();
    let restore: (() => void) | null = null;
    try {
      if (rateBefore !== 0) clock.setRate(0);
      s.adaptation.setHeld(true);
      if (p.pass !== p.idleKey) {
        const mod = await import(p.toggleModuleUrl) as {
          buildPassToggles(stellata: Stellata): PassToggle[];
        };
        const toggle = mod.buildPassToggles(s).find((t) => t.key === p.pass);
        if (toggle === undefined) throw new Error(`no pass '${p.pass}' in the priceFrame roster`);
        if (!toggle.present()) {
          throw new Error(`'${p.pass}' is not active at this vantage — nothing to round-trip`);
        }
        restore = toggle.disable();
      }
      for (let f = 0; f < p.offFrames; f++) {
        await new Promise((r) => requestAnimationFrame(r));
      }
      restore?.();
      restore = null;
      for (let f = 0; f < p.settleFrames; f++) {
        await new Promise((r) => requestAnimationFrame(r));
      }
    } finally {
      restore?.();
      s.adaptation.setHeld(false);
      if (clock.getRate() !== rateBefore) clock.setRate(rateBefore);
      releaseHold();
    }
  }, params);
}

/**
 * Clock rate and hold count read from OUTSIDE the dwell, so the restore is
 * checked by something other than the block that performed it.
 */
export function readRestoreState(page: Page): Promise<{ holds: number; clockRate: number }> {
  return page.evaluate(() => {
    const s = (window as unknown as PerfWindow).stellata;
    return { holds: s.renderGate.debugState.holds, clockRate: s.timeClock.getRate() };
  });
}

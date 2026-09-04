// Every page.evaluate the runner makes — boot, settle snapshot, adapter
// probe, rAF probe, the priceFrame call. Node-side orchestration is run.ts.

import type { BrowserContext, Page } from 'playwright';
import type { DebugTools } from '../../src/client/debug/debug';
import type { PriceFrameOptions, PriceFrameRow } from '../../src/client/debug/frame-cost/frame-cost';
import type { Stellata } from '../../src/client/stellata';
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

export interface WebGlProbe {
  readonly renderer: string;
  readonly vendor: string;
  readonly timerQuery: boolean;
}

export interface WebGpuProbe {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
  readonly isFallbackAdapter: boolean;
  readonly timestampsAvailable: boolean | null;
}

export interface AdapterProbe {
  readonly webgl: WebGlProbe | null;
  readonly webgpu: WebGpuProbe | null;
}

export function probeAdapters(page: Page): Promise<AdapterProbe> {
  return page.evaluate(async () => {
    const s = (window as unknown as PerfWindow).stellata;
    const gl = (s.rendererGL?.getContext() ?? document.createElement('canvas').getContext('webgl2')) as
      WebGL2RenderingContext | null;
    let webgl: WebGlProbe | null = null;
    if (gl !== null) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      webgl = {
        renderer: String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
        vendor: String(gl.getParameter(info ? info.UNMASKED_VENDOR_WEBGL : gl.VENDOR)),
        timerQuery: gl.getExtension('EXT_disjoint_timer_query_webgl2') !== null,
      };
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

// Decisions the runner makes before and around a launch, and the `run` block
// both instruments write. Pure, so they are testable away from run.ts, which
// cannot be imported without launching.

import type { GpuFrameMethod } from '../../src/client/debug/frame-cost/frame-cost-pure';
import type { AdapterProbe, GitProvenance, RunProvenance } from './schema';
import type { Backend, ScenarioName } from './scenarios';

/** Names a renderer that is not the GPU. Nothing measured on one counts, so
 *  a match aborts the whole run rather than failing one scenario. */
export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software/i;

/** rAF wall-clock deltas, whatever else was subscribed alongside. The GPU
 *  stream is a second opinion on the same frames, never the row's clock. */
export const DWELL_METHOD: GpuFrameMethod = 'raf-delta';

/** Playwright's full Chromium build, the one with a GPU process rather than
 *  the headless shell. Every launch here passes it and every `run` block
 *  records it, so the two cannot disagree about what was measured. */
export const BROWSER_CHANNEL = 'chromium';

export type MarkerVerdict = 'armed' | 'absent' | 'stale';

export interface ContextPlan {
  readonly name: ScenarioName;
  readonly backend: Backend;
  /** Rendered frames between statistic readbacks for this context's dwell. */
  readonly readbackEvery: number;
}

/**
 * The cadences one scenario is visited at, first one repeated LAST when
 * there is more than one — the same bracket `sweepOrder` puts around a set
 * of scales, for the same reason. The GPU's sustained-load ramp moves frame
 * time across a run whatever the cool-down (`pins/README.md` § Run
 * position), so a span rising across ascending cadences is a trend and the
 * clock's drift wearing the same shape. The two readings at the first
 * cadence bound the second, and without them a cadence probe cannot tell
 * them apart.
 */
export function readbackOrder(cadences: readonly number[]): number[] {
  return cadences.length > 1 ? [...cadences, cadences[0]] : [...cadences];
}

/** Backend-major, the scenarios as given within each backend — the order
 *  a pin row's position is read in (`pins/README.md` § Run position). */
export function contextOrder(
  scenarios: readonly ScenarioName[],
  backends: readonly Backend[],
): readonly { readonly name: ScenarioName; readonly backend: Backend }[] {
  return backends.flatMap((backend) => scenarios.map((name) => ({ name, backend })));
}

/**
 * The contexts a run visits, in order: `contextOrder` over the one backend, and —
 * where more than one cadence was asked for — each scenario once per cadence
 * in `readbackOrder`.
 */
export function planContexts(
  scenarios: readonly ScenarioName[],
  backend: Backend,
  cadences: readonly number[],
): readonly ContextPlan[] {
  const order = readbackOrder(cadences);
  return contextOrder(scenarios, [backend])
    .flatMap(({ name, backend }) => order.map((readbackEvery) => ({ name, backend, readbackEvery })));
}

/** The offending renderer string, or null. A fallback adapter counts even
 *  when it names no software rasteriser: it is not the device's own GPU. */
export function softwareRenderer(p: AdapterProbe): string | null {
  const candidates = [p.webgl?.renderer, p.webgpu?.description, p.webgpu?.device];
  const hit = candidates.find((s) => s !== undefined && SOFTWARE_RENDERER.test(s));
  if (hit !== undefined) return hit;
  return p.webgpu?.isFallbackAdapter ? 'WebGPU fallback adapter' : null;
}

/** The app caps its pixel ratio, so a `--dpr` past the cap draws at the cap
 *  while the header claims more. Aborts the run, not one scenario: every
 *  context would price the same smaller buffer under the same wrong label. */
export function bufferShortfall(
  viewport: { width: number; height: number; dpr: number },
  buffer: { width: number; height: number },
): string | null {
  const wanted = { width: Math.round(viewport.width * viewport.dpr), height: Math.round(viewport.height * viewport.dpr) };
  if (buffer.width >= wanted.width - 1 && buffer.height >= wanted.height - 1) return null;
  const effective = (buffer.width / viewport.width).toFixed(2);
  return (
    `drawing buffer ${buffer.width}x${buffer.height} is under the requested ` +
    `${viewport.width}x${viewport.height} @ dpr ${viewport.dpr} = ${wanted.width}x${wanted.height}: ` +
    `the app capped the pixel ratio (effective dpr ${effective}). ` +
    'A larger buffer comes from --width/--height, not --dpr.'
  );
}

export function describeProbe(p: AdapterProbe): string {
  const webgl = p.webgl
    ? `${p.webgl.renderer} · ${p.webgl.vendor} · EXT_disjoint_timer_query_webgl2 ${p.webgl.timerQuery ? 'present' : 'ABSENT'}`
    : 'no WebGL2 context';
  const webgpu = p.webgpu
    ? `${p.webgpu.description || p.webgpu.device || '(unnamed)'} · ${p.webgpu.vendor}/${p.webgpu.architecture} · ` +
      `fallback ${p.webgpu.isFallbackAdapter} · timestampsAvailable ${p.webgpu.timestampsAvailable ?? 'unread'}`
    : 'no adapter';
  return `webgl : ${webgl}\nwebgpu: ${webgpu}`;
}

/**
 * An arm authorises one launch attempt. `absent` and `stale` both refuse;
 * the caller deletes the marker either way, so a stale arm cannot be
 * inherited by the next invocation.
 */
export function markerVerdict(exists: boolean, ageMs: number, maxAgeMs: number): MarkerVerdict {
  if (!exists) return 'absent';
  return ageMs > maxAgeMs ? 'stale' : 'armed';
}

/** Prefixes the verdict the boot wait read off a mounted gate. A prefix
 *  rather than the bare verdict, so a `loading-status` that happens to
 *  read like one cannot be mistaken for a gate. */
export const GATE_BOOT_PREFIX = 'gate:';

/**
 * Why a boot produced no measurable page, or null when it did.
 *
 * The requires-WebGPU gate is the case worth naming. `showWebGpuGate` hides
 * the boot's elements rather than removing them and never sets
 * `window.stellata`, so every predicate the wait polls stays false and the
 * scenario used to die on the Playwright timeout with nothing said about
 * why. Not reachable on the machine the pin is taken on, where both
 * backends work — this is about a legible failure anywhere else.
 */
export function bootFailure(text: string): string | null {
  if (text === 'ok') return null;
  if (text.startsWith(GATE_BOOT_PREFIX)) {
    return (
      `the requires-WebGPU gate took the page over, verdict '${text.slice(GATE_BOOT_PREFIX.length)}'` +
      ' — this browser cannot run the renderer, so there is no frame to price'
    );
  }
  return text;
}

/** What only the caller knows about a run: the rest of the block is the same
 *  for every instrument, which is why it is assembled in one place. */
export interface RunStart {
  readonly startedAt: string;
  readonly url: string;
  readonly browserVersion: string;
  readonly headless: boolean;
  readonly chromeArgs: readonly string[];
  readonly git: GitProvenance;
  readonly gpu: AdapterProbe | null;
}

/** Stamps `finishedAt`, so it is called once the last context has closed. */
export function runProvenance(start: RunStart): RunProvenance {
  return {
    startedAt: start.startedAt,
    finishedAt: new Date().toISOString(),
    url: start.url,
    argv: process.argv.slice(2),
    git: start.git,
    browser: {
      name: BROWSER_CHANNEL,
      version: start.browserVersion,
      channel: BROWSER_CHANNEL,
      headless: start.headless,
      args: start.chromeArgs,
    },
    gpu: start.gpu,
    host: { platform: process.platform, arch: process.arch },
  };
}

// Decisions the runner makes before and around a launch: which clock, which
// adapters disqualify a run, how the probe reads. Pure, so they are testable
// away from run.ts, which cannot be imported without launching.

import type { GpuFrameMethod } from '../../src/client/debug/frame-cost/frame-cost-pure';
import type { AdapterProbe } from './schema';
import type { BackendRequest } from './args';

/** Names a renderer that is not the GPU. Nothing measured on one counts, so
 *  a match aborts the whole run rather than failing one scenario. */
export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software/i;

/** rAF wall-clock deltas, whatever else was subscribed alongside. The GPU
 *  stream is a second opinion on the same frames, never the row's clock. */
export const DWELL_METHOD: GpuFrameMethod = 'raf-delta';

export type MarkerVerdict = 'armed' | 'absent' | 'stale';

/**
 * The clock a run will use. `both` pins rAF wall time because the backends'
 * best clocks are three different instruments — taking each one's best would
 * build exactly the mixed-method table that must never be compared. An
 * explicit `--method` wins, on the caller's head, and the run says it did.
 */
export function methodFor(args: { backend: BackendRequest; method?: GpuFrameMethod }): {
  method: GpuFrameMethod | undefined;
  why: string | null;
} {
  if (args.method !== undefined) return { method: args.method, why: null };
  if (args.backend !== 'both') return { method: undefined, why: null };
  return {
    method: DWELL_METHOD,
    why:
      `--backend both pins --method ${DWELL_METHOD}: it is the one clock WebGL2 and WebGPU ` +
      'share, and a table mixing timer-query with timestamp compares two instruments. ' +
      'Pass --method explicitly to override.',
  };
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
      `fallback ${p.webgpu.isFallbackAdapter} · timestampsAvailable ${p.webgpu.timestampsAvailable ?? 'n/a on a webgl2 boot'}`
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

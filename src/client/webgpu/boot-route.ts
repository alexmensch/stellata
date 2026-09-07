// Which renderer a load gets, or the gate page instead. See README.md
// § The renderer is WebGPU.

import type { GateVerdict } from './gate/gate-advice-pure';
import type { WebGpuVerdict } from './gate/webgpu-support';
import { parseGateOverride, parseRendererFlag, type RendererKind } from './renderer-flag';

export type BootRoute =
  | { kind: 'gate'; verdict: GateVerdict }
  | { kind: 'boot'; renderer: RendererKind };

/**
 * `probe` is a thunk, not a verdict: neither the escape hatch nor the gate
 * override may pay for a `requestAdapter`, and the WebGL2 route has to
 * settle on a browser that would fail the probe outright.
 *
 * The caller must run this BEFORE fetching the catalogue, so a browser
 * that cannot render downloads nothing it cannot use.
 */
export async function resolveBootRoute(
  hash: string,
  probe: () => Promise<WebGpuVerdict>,
): Promise<BootRoute> {
  const forced = parseGateOverride(hash);
  if (forced !== null) return { kind: 'gate', verdict: forced };

  const renderer = parseRendererFlag(hash) ?? 'webgpu';
  if (renderer === 'webgl2') return { kind: 'boot', renderer };

  const verdict = await probe();
  return verdict === 'supported'
    ? { kind: 'boot', renderer: 'webgpu' }
    : { kind: 'gate', verdict };
}

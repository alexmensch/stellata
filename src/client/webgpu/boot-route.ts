// Which load gets the renderer, and which gets the gate page instead. See
// README.md#the-renderer-is-webgpu.

import type { GateVerdict } from './gate/gate-advice-pure';
import { parseGateOverride } from './gate/gate-override';
import type { WebGpuVerdict } from './gate/webgpu-support';

export type BootRoute =
  | { kind: 'gate'; verdict: GateVerdict }
  | { kind: 'boot' };

/**
 * `probe` is a thunk, not a verdict: the gate override may not pay for a
 * `requestAdapter`.
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

  const verdict = await probe();
  return verdict === 'supported' ? { kind: 'boot' } : { kind: 'gate', verdict };
}

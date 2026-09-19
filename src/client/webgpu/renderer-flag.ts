// Parse the renderer escape hatch, the gate override and the refill-mode
// probe from the URL fragment — the one URL slot the address-bar writers
// preserve verbatim (see README.md).

import type { ExtinctionRefillMode } from '../star-pipeline/extinction/extinction-seam';
import type { GateVerdict } from './gate/gate-advice-pure';

export type RendererKind = 'webgl2' | 'webgpu';

function fragmentParam(hash: string, key: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, '')).get(key);
}

export function parseRendererFlag(hash: string): RendererKind | null {
  const v = fragmentParam(hash, 'renderer');
  return v === 'webgpu' || v === 'webgl2' ? v : null;
}

/** `#av-refill=survivors` — the dev switch for the probe schedule
 *  (`extinction/refill/README.md` § The survivor-driven probe). Absent, the
 *  boot takes the shipped `sliced` one. */
export function parseExtinctionRefillMode(hash: string): ExtinctionRefillMode | null {
  const v = fragmentParam(hash, 'av-refill');
  return v === 'sliced' || v === 'survivors' ? v : null;
}

/**
 * `#webgpu-gate=<verdict>` — the dev switch that shows the requires-WebGPU
 * page on a browser that supports WebGPU perfectly well. The value picks
 * WHICH page: the two verdicts give different advice, and a supporting
 * browser fails neither probe (`gate/README.md` § The dev switch). `force`
 * stays as the spelling for the commoner of the two.
 */
export function parseGateOverride(hash: string): GateVerdict | null {
  const v = fragmentParam(hash, 'webgpu-gate');
  if (v === 'no-api' || v === 'no-adapter') return v;
  return v === 'force' ? 'no-api' : null;
}

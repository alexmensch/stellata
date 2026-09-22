// The gate's dev switch. See README.md § The dev switch.

import type { GateVerdict } from './gate-advice-pure';

/** `force` stays as the spelling for the commoner of the two verdicts. */
export function parseGateOverride(hash: string): GateVerdict | null {
  const v = new URLSearchParams(hash.replace(/^#/, '')).get('webgpu-gate');
  if (v === 'no-api' || v === 'no-adapter') return v;
  return v === 'force' ? 'no-api' : null;
}

// Each pair's total mass from its two components' spectral types, computed once before Stage 5. See README.md.

import type { IdentifierIndices } from '../load/indices-pure';
import type { DecomposedPair } from '../resolve/components-pure';
import { athygRowFor, resolveSpect } from '../components/component-spect-pure';
import { massFromSpectralClass } from './mass-estimate-pure';

/** Deliberately generous: an unknown type must raise Stage 5's escape velocity, never lower it. */
export const UNKNOWN_COMPONENT_MASS_MSUN = 3.0;

export function pairMasses(pairs: readonly DecomposedPair[], indices: IdentifierIndices): ReadonlyMap<DecomposedPair, number> {
  const out = new Map<DecomposedPair, number>();
  for (const p of pairs) {
    let total = 0.0;
    for (const c of [p.primary, p.secondary]) {
      const { spect } = resolveSpect(p.pair.wdsId, c.component, athygRowFor(c, indices), indices);
      total += massFromSpectralClass(spect) ?? UNKNOWN_COMPONENT_MASS_MSUN;
    }
    out.set(p, total);
  }
  return out;
}

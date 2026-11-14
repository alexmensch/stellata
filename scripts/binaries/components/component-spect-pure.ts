// A component's AT-HYG row and spectral type, each through its cascade, with the spect_via tag. See README.md.

import { componentKey } from '../component-tokens-pure';
import type { AthygRow } from '../load/athyg-pure';
import type { IdentifierIndices } from '../load/indices-pure';
import type { SpectVia } from '../multiples-record-pure';
import type { ResolvedComponent } from '../resolve/components-pure';

/** The position-matched row, then the Gaia source's, then the HIP's. */
export function athygRowFor(c: ResolvedComponent, indices: IdentifierIndices): AthygRow | null {
  if (c.athyg !== null) return c.athyg.value;
  if (c.gaia !== null) {
    const row = indices.srcToAthyg.get(c.gaia.value);
    if (row !== undefined) return row;
  }
  return c.hip === null ? null : indices.hipToAthyg.get(c.hip.value) ?? null;
}

export interface ResolvedSpect {
  /** Empty when `spectVia` is `none`. */
  readonly spect: string;
  readonly spectVia: SpectVia;
}

/** Curated, then SIMBAD's per-component type, then the MSC's, then the AT-HYG row's. */
export function resolveSpect(
  wdsId: string, component: string, athyg: AthygRow | null, indices: IdentifierIndices,
): ResolvedSpect {
  const key = componentKey(wdsId, component);
  const curated = indices.componentSptypeOverrides.get(key);
  if (curated) return { spect: curated, spectVia: 'curated' };
  const simbad = indices.simbadWdsSpectra.get(key);
  if (simbad) return { spect: simbad, spectVia: 'simbad' };
  const msc = indices.msc.spectByComp.get(key);
  if (msc) return { spect: msc, spectVia: 'msc' };
  if (athyg?.spect) return { spect: athyg.spect, spectVia: 'athyg' };
  return { spect: '', spectVia: 'none' };
}

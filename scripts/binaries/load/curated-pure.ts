// The three hand-curated binaries tables: ORB6 component overrides, component spectral types, astrometry exclusions.

import type { Declared } from '../../util/sources/source';
import { readTable } from '../../util/tsv/table-pure';
import { componentKey, discovererKey, type ComponentKey, type DiscovererKey } from '../component-tokens-pure';

export function parseOrb6ComponentOverrides(text: string, from: Declared): Map<DiscovererKey, string> {
  const out = new Map<DiscovererKey, string>();
  const columns = ['wds_id', 'discoverer', 'components'] as const;
  for (const row of readTable({ ...from, columns, comments: true }, text)) {
    out.set(discovererKey(row.requiredText('wds_id'), row.requiredText('discoverer')), row.requiredText('components'));
  }
  return out;
}

/** MK type by the raw multiples.tsv comp form (Algol's Aa1,2 secondary is `"2"`). */
export function parseComponentSptypeOverrides(text: string, from: Declared): Map<ComponentKey, string> {
  const out = new Map<ComponentKey, string>();
  const columns = ['wds_id', 'component', 'sp_type'] as const;
  for (const row of readTable({ ...from, columns, comments: true }, text)) {
    out.set(componentKey(row.requiredText('wds_id'), row.requiredText('component')), row.requiredText('sp_type'));
  }
  return out;
}

/** source_id → reason, for Gaia 5p solutions a blend made unusable (Sirius B). */
export function parseAstrometryExclusions(text: string, from: Declared): Map<string, string> {
  const out = new Map<string, string>();
  const columns = ['gaia_source_id', 'reason'] as const;
  for (const row of readTable({ ...from, columns, comments: true }, text)) {
    out.set(row.requiredSourceId('gaia_source_id'), row.text('reason') ?? '');
  }
  return out;
}

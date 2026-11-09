// The hand-curated SIMBAD oid overrides for WDS components the ident lookup and the cascade miss. See README.md#overrides.

import type { Declared } from '../../util/sources/source';
import { readTable } from '../../util/tsv/table-pure';
import { componentId, type WdsComponent } from './wds-components-pure';

export interface WdsXidOverride extends WdsComponent {
  readonly oid: number;
}

/** One override per component: a second row for the same component is refused, never last-wins. */
export function parseWdsXidsOverrides(text: string, from: Declared): WdsXidOverride[] {
  const columns = ['wds_id', 'component', 'simbad_oid', 'reason'] as const;
  const out = new Map<string, WdsXidOverride>();
  for (const row of readTable({ ...from, columns, comments: true }, text)) {
    const override = { wdsId: row.requiredText('wds_id'), component: row.requiredText('component'), oid: row.requiredId('simbad_oid') };
    row.requiredText('reason');
    const id = componentId(override);
    const held = out.get(id);
    if (held !== undefined) row.fail(`a second override for ${id} (oid ${held.oid}, then ${override.oid})`);
    out.set(id, override);
  }
  return [...out.values()];
}

/** Every override names a component the WDS summary decomposes into: an orphan has no pair for Stage 2 to bind it on. */
export function assertOverridesOnComponents(overrides: readonly WdsXidOverride[], components: readonly WdsComponent[], file: string): void {
  const known = new Set(components.map(componentId));
  const orphans = overrides.map(componentId).filter((id) => !known.has(id)).sort();
  if (orphans.length > 0) {
    throw new Error(`${file} names ${orphans.length} components the WDS summary does not decompose into: ${orphans.join(', ')}`);
  }
}

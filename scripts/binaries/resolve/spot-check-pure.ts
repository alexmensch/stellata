// The Stage 2 spot-check: curated (wds_id, component) → expected tier and source, against the strongest resolution. See README.md#the-spot-check.

import { componentKey, type ComponentKey } from '../component-tokens-pure';
import { RESOLVE_VIA } from '../multiples-tsv';
import type { TableRow } from '../../util/tsv/table-pure';
import { priorityOf, type DecomposedPair, type ResolvedComponent } from './components-pure';
import type { ResolveVia } from '../multiples-tsv';

export const SPOT_CHECK_COLUMNS = [
  'category', 'name', 'wds_id', 'component', 'expected_resolve_via', 'expected_gaia_source_id', 'note',
] as const;

type Column = (typeof SPOT_CHECK_COLUMNS)[number];

/** Stage 2 emits no component at all for the key. */
export const EXPECTED_ABSENT = 'absent';

export interface TruthRow {
  readonly category: string;
  readonly name: string;
  readonly key: ComponentKey;
  readonly expected: { readonly via: ResolveVia; readonly gaiaSourceId: string | null } | typeof EXPECTED_ABSENT;
  readonly note: string;
}

export function truthRow(row: TableRow<Column>): TruthRow {
  const via = row.raw('expected_resolve_via');
  return {
    category: row.raw('category'),
    name: row.raw('name'),
    key: componentKey(row.raw('wds_id'), row.raw('component')),
    expected: via === EXPECTED_ABSENT
      ? EXPECTED_ABSENT
      : { via: row.oneOf('expected_resolve_via', RESOLVE_VIA), gaiaSourceId: row.sourceId('expected_gaia_source_id') },
    note: row.raw('note'),
  };
}

export function strongestComponents(pairs: readonly DecomposedPair[]): Map<ComponentKey, ResolvedComponent> {
  const best = new Map<ComponentKey, ResolvedComponent>();
  for (const p of pairs) {
    for (const c of [p.primary, p.secondary]) {
      const key = componentKey(c.wdsId, c.component);
      const prev = best.get(key);
      if (prev === undefined || priorityOf(c.resolveVia) < priorityOf(prev.resolveVia)) best.set(key, c);
    }
  }
  return best;
}

/** Each way the row is not met; the tier and the source report apart, so a
 *  tier drift and an id drift read differently. */
export function spotCheckProblems(row: TruthRow, best: ReadonlyMap<ComponentKey, ResolvedComponent>): string[] {
  const got = best.get(row.key);
  if (row.expected === EXPECTED_ABSENT) {
    return got === undefined ? [] : [`expected NO component, got (${got.gaiaSourceId}, ${got.resolveVia})`];
  }
  const { via, gaiaSourceId } = row.expected;
  if (got === undefined) return [`expected (${gaiaSourceId}, ${via}), got no component at all`];
  const problems: string[] = [];
  if (got.resolveVia !== via) problems.push(`resolve_via: expected ${via}, got ${got.resolveVia}`);
  if (got.gaiaSourceId !== gaiaSourceId) problems.push(`gaia_source_id: expected ${gaiaSourceId}, got ${got.gaiaSourceId}`);
  return problems;
}

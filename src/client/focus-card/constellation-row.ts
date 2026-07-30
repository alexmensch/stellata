// The Constellation row every non-stellar card carries.
// See ./README.md § Constellation row.

import type { TargetKind } from '../camera/focus/focus-target';
import type { FocusCardRow } from './focus-card-types';

/** The kinds that resolve the row positionally. `star` and `shell` are
 *  excluded at the type level rather than by convention — see
 *  `Stellata.constellationOf`. */
export type ConstellationOfKind = Exclude<TargetKind, 'star' | 'shell'>;

/**
 * Zero rows or one, so a provider spreads the result instead of branching:
 * nothing at all when the boundary artifact never loaded, since a card should
 * not carry a row it can't answer.
 *
 * **LIVE for every kind.** A planet's constellation is an ephemeris statement
 * that moves with the model clock, and one grid lookup per tick is cheaper
 * than a per-kind decision about which bodies move. The first answer is the
 * fallback, so a frame where the position doesn't resolve holds the last known
 * value rather than blanking the row.
 */
export function constellationRows(nameAt: () => string | null): FocusCardRow[] {
  const initial = nameAt();
  if (initial === null) return [];
  return [{ label: 'Constellation', value: () => nameAt() ?? initial }];
}

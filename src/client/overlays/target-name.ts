import type { Stellata } from '../stellata';
import type { Target, TargetKind } from '../camera/focus/focus-target';
import { resolveStarName } from '../format/star-companion-format';
import { displayNameOf } from '../kinds/kind-modules';

/** Exhaustive over TargetKind so a new kind fails tsc here rather than
 *  silently labelling as ''. */
const KIND_FALLBACK: Record<TargetKind, string> = {
  star: 'Star',
  planet: 'Planet',
  probe: 'Probe',
  cloud: 'Cloud',
  lg: 'Galaxy',
  shell: 'Shell',
};

/** Display name for any Target — the overlay binding of the kind-module
 *  lookup (`displayNameOf`), shared by the POI overlay labels and the
 *  distance-vector destination label. Star names resolve over the
 *  search-corpus `starLabels`. */
export function targetDisplayName(
  stellata: Stellata,
  starLabels: Map<number, string>,
  t: Target,
): string {
  const name = displayNameOf(stellata.kinds, t, (idx) => resolveStarName(
    {
      starLabels,
      gaiaSourceId: stellata.catalog.gaiaSourceId,
      sid: stellata.catalog.sid,
    },
    idx,
  ));
  return name || KIND_FALLBACK[t.kind];
}

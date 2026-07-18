import type { Stellata } from '../stellata';
import type { Target } from '../camera/focus/focus-target';
import { resolveStarName } from '../format/star-companion-format';

/** Display name for any Target kind — the shared per-kind lookup behind
 *  the POI overlay labels and the distance-vector destination label.
 *  Star names live on the search corpus (`starLabels`); the other kinds
 *  read their layer's catalog. */
export function targetDisplayName(
  stellata: Stellata,
  starLabels: Map<number, string>,
  t: Target,
): string {
  if (t.kind === 'star') {
    return resolveStarName(
      {
        starLabels,
        gaiaSourceId: stellata.catalog.gaiaSourceId,
        sid: stellata.catalog.sid,
      },
      t.idx,
    );
  }
  if (t.kind === 'planet') return stellata.planetField.planetAt(t.idx)?.name ?? 'Planet';
  if (t.kind === 'cloud') {
    const cat = stellata.getCloudCatalog();
    return cat ? cat.clouds[t.idx].name : 'Cloud';
  }
  return stellata.localGroup?.objects[t.idx]?.name ?? 'Galaxy';
}

import type { Stellata } from '../stellata';
import type { Target } from '../camera/focus/focus-target';
import { resolveStarName } from '../format/star-companion-format';

/** Display name for any Target kind — the shared per-kind lookup behind
 *  the POI overlay labels and the distance-vector destination label.
 *  Star names live on the search corpus (`starLabels`); every migrated
 *  kind answers through its module's `displayName` leg, planets through
 *  the planet field. The `switch` returns on every kind so a
 *  new `TargetKind` fails `tsc` (missing return) rather than silently
 *  falling through to the wrong catalog. */
export function targetDisplayName(
  stellata: Stellata,
  starLabels: Map<number, string>,
  t: Target,
): string {
  switch (t.kind) {
    case 'star':
      return resolveStarName(
        {
          starLabels,
          gaiaSourceId: stellata.catalog.gaiaSourceId,
          sid: stellata.catalog.sid,
        },
        t.idx,
      );
    case 'planet':
      return stellata.planetField.planetAt(t.idx)?.name ?? 'Planet';
    case 'probe':
      return stellata.kinds.probe.displayName(t.idx) || 'Probe';
    case 'cloud':
      return stellata.kinds.cloud.displayName(t.idx) || 'Cloud';
    case 'lg':
      return stellata.kinds.lg.displayName(t.idx) || 'Galaxy';
    case 'shell':
      return stellata.kinds.shell.displayName(t.idx) || 'Shell';
  }
}

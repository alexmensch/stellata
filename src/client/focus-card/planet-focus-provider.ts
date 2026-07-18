// Planet provider for the tier-2 focus card — camera-frame + intrinsic
// rows. See ./README.md § Frame-of-reference principle.

import type { Planet, PlanetType } from '../solar-system/planet-system';
import { fmtDistAuto } from '../ui/distance-util';
import {
  formatEarthRadii,
  formatMagnitude,
  formatPeriodYears,
  planetPeriodYears,
} from '../format/physical-format';
import type { FocusCardContent, FocusCardProvider, FocusCardRow } from './focus-card-types';

const TYPE_DESCRIPTOR: Record<PlanetType, string> = {
  rocky: 'Rocky planet',
  gas_giant: 'Gas giant',
  ice_giant: 'Ice giant',
  icy: 'Icy moon',
};

export interface PlanetFocusProviderConfig {
  /** Planet record for a flat instance index (PlanetBodyField.planetAt). */
  planetAt: (idx: number) => Planet | null;
  /** Host star's display name, or null when unnamed / unattached. */
  hostNameOf: (idx: number) => string | null;
  /** Live camera→planet distance in the local frame, pc. */
  cameraDistancePc: (idx: number) => number | null;
  /** Live apparent V mag from the camera (shader mirror). */
  appMagFor: (idx: number) => number | null;
}

export function createPlanetFocusProvider(
  config: PlanetFocusProviderConfig,
): FocusCardProvider<'planet'> {
  return {
    kind: 'planet',
    format(idx: number): FocusCardContent {
      const planet = config.planetAt(idx);
      if (!planet) return { name: '', identityLines: [], rows: [], lines: [] };

      const identityLines: string[] = [];
      // Breadcrumb: header carries the body, this line its system —
      // "Earth" / "Orbiting Sol".
      const hostName = config.hostNameOf(idx);
      if (hostName) identityLines.push(`Orbiting ${hostName}`);
      identityLines.push(TYPE_DESCRIPTOR[planet.type]);

      const rows: FocusCardRow[] = [
        { label: 'Radius', value: formatEarthRadii(planet.radiusKm) },
        {
          label: 'Distance',
          value: () => {
            const d = config.cameraDistancePc(idx);
            return d !== null && Number.isFinite(d) ? fmtDistAuto(d) : '—';
          },
        },
        {
          label: 'App mag',
          value: () => {
            const m = config.appMagFor(idx);
            return m !== null && Number.isFinite(m) ? formatMagnitude(m) : '—';
          },
        },
        {
          label: 'Period',
          value: `${formatPeriodYears(planetPeriodYears(planet.semiMajorAxisAu))} yr`,
        },
        {
          label: 'Orbit',
          value: `${planet.semiMajorAxisAu.toFixed(planet.semiMajorAxisAu >= 10 ? 1 : 3)} AU`,
        },
      ];

      return { name: planet.name, identityLines, rows, lines: [] };
    },
  };
}

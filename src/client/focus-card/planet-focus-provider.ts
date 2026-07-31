// Planet provider for the tier-2 focus card — camera-frame + intrinsic
// rows. See ./README.md § Frame-of-reference principle.

import type { Planet, PlanetType } from '../solar-system/planet-system';
import {
  formatOrbitDistance,
  formatOrbitPeriod,
  type OrbitDescriptor,
} from '../solar-system/ephemerides/orbit-descriptor';
import { fmtDistAuto } from '../ui/distance-util';
import { formatEarthRadii, formatMagnitude } from '../format/physical-format';
import { constellationRows } from './constellation-row';
import type { FocusCardContent, FocusCardProvider, FocusCardRow } from './focus-card-types';

const TYPE_DESCRIPTOR: Record<PlanetType, string> = {
  rocky: 'Rocky planet',
  gas_giant: 'Gas giant',
  ice_giant: 'Ice giant',
  icy: 'Icy moon',
};

/** Type line for a moon — labelled a moon, not a planet class. Moons are
 *  only ever rocky (the Moon, Io) or icy (everything else). */
function moonTypeDescriptor(type: PlanetType): string {
  return type === 'rocky' ? 'Rocky moon' : 'Icy moon';
}

export interface PlanetFocusProviderConfig {
  /** Planet record for a flat instance index (PlanetBodyField.planetAt). */
  planetAt: (idx: number) => Planet | null;
  /** Parent/orbit descriptor for the body — breadcrumb parent, orbit, and
   *  period, resolved against the parent (host star for a planet, parent
   *  planet for a moon). Null omits the orbit rows. */
  orbitDescriptorOf: (idx: number) => OrbitDescriptor | null;
  /** Live camera→planet distance in the local frame, pc. */
  cameraDistancePc: (idx: number) => number | null;
  /** Live apparent V mag from the camera (shader mirror). */
  appMagFor: (idx: number) => number | null;
  /** The body's moon names in semi-major-axis order (empty for moons
   *  and moonless bodies) — same source the hover card reads; the
   *  focus card shows the uncapped list. */
  moonNamesOf: (idx: number) => readonly string[];
  /** § Constellation row. */
  constellationName: (idx: number) => string | null;
}

export function createPlanetFocusProvider(
  config: PlanetFocusProviderConfig,
): FocusCardProvider<'planet'> {
  return {
    kind: 'planet',
    format(idx: number): FocusCardContent {
      const planet = config.planetAt(idx);
      if (!planet) return { name: '', identityLines: [], rows: [], lines: [] };

      const orbit = config.orbitDescriptorOf(idx);
      const identityLines: string[] = [];
      // Breadcrumb: header carries the body, this line its parent —
      // "Earth" / "Orbiting Sol"; "Europa" / "Orbiting Jupiter".
      if (orbit?.parentName) identityLines.push(`Orbiting ${orbit.parentName}`);
      identityLines.push(
        planet.parentName ? moonTypeDescriptor(planet.type) : TYPE_DESCRIPTOR[planet.type],
      );

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
      ];
      if (orbit) {
        rows.push(
          { label: 'Period', value: formatOrbitPeriod(orbit) },
          { label: 'Orbit', value: formatOrbitDistance(orbit) },
        );
      }

      rows.push(...constellationRows(() => config.constellationName(idx)));

      // Standard row, one name per line — the 'Known companions' shape.
      const moonNames = config.moonNamesOf(idx);
      if (moonNames.length > 0) {
        rows.push({ label: 'Moons', value: moonNames.join('\n') });
      }

      return { name: planet.name, identityLines, rows, lines: [] };
    },
  };
}

// Planet hover provider — picks across every attached host's planets.
// See ./README.md.

import type { Stellata } from '../stellata';
import {
  formatPlanetHover,
  type PlanetHoverFormatContext,
} from './formatters/planet-hover-format';
import { orbitDescriptorFor } from '../solar-system/orbit-descriptor';
import { moonNamesOf } from '../solar-system/planet-system';
import type { HoverProvider } from './hover-types';

export interface PlanetHoverProviderConfig {
  stellata: Stellata;
}

export function createPlanetHoverProvider(
  config: PlanetHoverProviderConfig,
): HoverProvider<'planet'> {
  const { stellata } = config;
  return {
    kind: 'planet',
    pick: (x, y, pxThreshold) => stellata.picker.pickPlanetHit(x, y, pxThreshold),
    format: (hit) => {
      const hostStarIdx = hit.hostStarIdx;
      if (hostStarIdx === undefined) return null;
      const ps = stellata.getAttachedPlanetSystem(hostStarIdx);
      if (!ps) return null;
      // The cached PlanetSystem is the source of truth for `planets`;
      // apparent V mag comes from the renderer's PlanetBodyField via a
      // Stellata accessor so it tracks the current camera + ephemeris.
      const ctx: PlanetHoverFormatContext = {
        planets: ps.planets,
        appMagFor: (i) => stellata.planetApparentMag(hostStarIdx, i),
        // Period only — the hover card shows no breadcrumb, so hostName
        // is irrelevant (null); the descriptor's period/unit is what the
        // shared formatter needs.
        orbitOf: (i) => {
          const p = ps.planets[i];
          return p ? orbitDescriptorFor(p, ps, null) : null;
        },
        moonsOf: (i) => moonNamesOf(ps.planets, i),
        membership: stellata.systemMembership,
        targetOf: (i) => {
          const flat = stellata.planetField.instanceIndexOf(hostStarIdx, i);
          return flat === null ? null : { kind: 'planet', idx: flat };
        },
      };
      return formatPlanetHover(hit.idx, hit.cameraDistancePc, ctx);
    },
  };
}

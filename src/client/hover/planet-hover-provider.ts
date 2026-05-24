// Planet hover provider — picks across every attached host's planets.
// See ./README.md.

import type { Stellata } from '../stellata';
import {
  formatPlanetHover,
  type PlanetHoverFormatContext,
} from './formatters/planet-hover-format';
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
      if (hostStarIdx === undefined) return { name: '', lines: [] };
      const ps = stellata.getAttachedPlanetSystem(hostStarIdx);
      if (!ps) return { name: '', lines: [] };
      // The cached PlanetSystem is the source of truth for `planets`;
      // live distance and apparent V mag come from the renderer's
      // PlanetBodyField via Stellata accessors so they track the
      // current camera + ephemeris.
      const ctx: PlanetHoverFormatContext = {
        planets: ps.planets,
        distanceFromHostPc: (i) => stellata.planetHostDistancePc(hostStarIdx, i),
        appMagFor: (i) => stellata.planetApparentMag(hostStarIdx, i),
      };
      return formatPlanetHover(hit.idx, ctx);
    },
  };
}

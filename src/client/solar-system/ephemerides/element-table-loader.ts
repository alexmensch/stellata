// Fetches the nine planet element tables from public/ephemerides/ and installs
// them into the ephemeris. See README.md § Horizons element tables.

import { ELEMENT_TARGETS } from '../../../../scripts/ephemerides/planet-element-roster';
import { planetElementFilename } from '../../../../scripts/ephemerides/sync-ephemerides-pure';
import type { PlanetElementTableFile } from '../../../../scripts/ephemerides/planet-element-schema';
import { buildElementTable, type PlanetElementTable } from './element-table';
import { installPlanetElementTables } from './ephemeris';
import type { PlanetName } from './ephemeris';

/**
 * Load every table whose artifact is present and install it. A missing or
 * malformed file drops that planet onto the Standish series rather than
 * failing the load — the scene renders identically, at the series' own
 * accuracy, which is what a checkout that never ran the `public/` sync gets.
 *
 * Deliberately **not** awaited on the critical path: 1.5 MB behind first paint
 * would be a poor trade for a first frame that is Sol-focused, where the outer
 * planets the tables move are sub-pixel discs.
 */
export async function loadPlanetElementTables(baseUrl: string): Promise<void> {
  const loaded = new Map<PlanetName, PlanetElementTable>();
  await Promise.all(
    ELEMENT_TARGETS.map(async (target) => {
      try {
        const res = await fetch(`${baseUrl}ephemerides/${planetElementFilename(target.id)}`);
        if (!res.ok) return;
        loaded.set(target.id, buildElementTable(await res.json() as PlanetElementTableFile));
      } catch {
        // Left out of the map: that planet keeps the Standish series.
      }
    }),
  );
  if (loaded.size > 0) installPlanetElementTables(loaded);
}

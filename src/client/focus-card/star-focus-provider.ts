// Star provider for the tier-2 focus card — camera-frame + intrinsic
// rows only. See ./README.md § Frame-of-reference principle.

import type { Catalog } from '../loaders/catalog-loader';
import type { BinariesData } from '../binaries/binaries-loader';
import type { SearchEntry } from '../typeahead/search';
import { starDesignations } from '../typeahead/search';
import { fmtDistAuto } from '../ui/distance-util';
import { formatSpectral, spectralLine } from '../format/spectral-format';
import {
  appMagCameraDisplay,
  coarseProvenance,
  formatKelvin,
  formatSolarRadii,
} from '../format/physical-format';
import { formatSpaceVelocity, spaceVelocity } from '../format/velocity-format';
import { companionLines, resolveStarName } from '../format/star-companion-format';
import type { FocusCardContent, FocusCardProvider, FocusCardRow } from './focus-card-types';

export interface StarFocusProviderConfig {
  catalog: Catalog;
  starLabels: Map<number, string>;
  spectralMap: Map<number, string>;
  searchEntries: Map<number, SearchEntry>;
  binaries: BinariesData | null;
  /** Live camera→star distance in the local frame, pc. */
  cameraDistancePc: (idx: number) => number;
  /** Current sim time as JD — drives the Tier-1 live companion separation. */
  nowJd: () => number;
}

export function createStarFocusProvider(
  config: StarFocusProviderConfig,
): FocusCardProvider<'star'> {
  const { catalog, starLabels, spectralMap, searchEntries, binaries } = config;

  return {
    kind: 'star',
    format(idx: number): FocusCardContent {
      const name = resolveStarName(starLabels, idx);
      const identityLines: string[] = [];
      const entry = searchEntries.get(idx);
      const alts = (entry
        ? starDesignations(entry, catalog.constellations, catalog.gaiaSourceId[idx])
        : []
      ).filter((d) => d !== name);
      if (alts.length > 0) identityLines.push(alts.join(' · '));
      const spect = spectralLine(
        formatSpectral(
          spectralMap.get(idx),
          catalog.spectClass[idx],
          catalog.luminosityClass[idx],
        ),
      );
      if (spect) identityLines.push(spect);

      const absmag = catalog.absmag[idx];
      const rows: FocusCardRow[] = [
        { label: 'Radius', value: formatSolarRadii(catalog.physicalRadius[idx]) },
        { label: 'Distance', value: () => fmtDistAuto(config.cameraDistancePc(idx)) },
      ];
      // Two independent Gaia solutions; either may be absent (NaN).
      const teff = !Number.isNaN(catalog.teffGspphot[idx])
        ? catalog.teffGspphot[idx]
        : catalog.teffGspspec[idx];
      if (!Number.isNaN(teff)) rows.push({ label: 'Temperature', value: formatKelvin(teff) });
      rows.push({ label: 'Abs mag', value: absmag.toFixed(2) });
      // Row always present as a stable affordance; the value collapses to
      // "—" inside the gate band so the card never pops rows in and out.
      rows.push({
        label: 'App mag',
        value: () => appMagCameraDisplay(absmag, config.cameraDistancePc(idx)),
      });
      const vel = spaceVelocity(
        catalog.velocities[idx * 3],
        catalog.velocities[idx * 3 + 1],
        catalog.velocities[idx * 3 + 2],
      );
      if (vel) rows.push({ label: 'Velocity', value: formatSpaceVelocity(vel) });
      const prov = coarseProvenance({
        gaiaSourceId: catalog.gaiaSourceId[idx],
        hip: catalog.hip[idx],
        hd: entry?.hd,
      });
      if (prov.length > 0) rows.push({ label: 'Known from', value: prov.join(' · ') });
      const conIdx = catalog.constellation[idx];
      if (conIdx !== 255) {
        rows.push({ label: 'Constellation', value: catalog.constellations[conIdx].name });
      }

      const lines: FocusCardContent['lines'] = [];
      // Live so a Tier-1 pair's ρ tracks the sim clock exactly as the
      // hover card's does — shared fields must agree between tiers.
      const companions = () =>
        companionLines(idx, { starLabels, binaries, nowJd: config.nowJd() }).join('\n');
      if (companions()) lines.push(companions);

      return { name, identityLines, rows, lines };
    },
  };
}

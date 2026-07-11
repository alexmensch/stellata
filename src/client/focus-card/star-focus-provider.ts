// Star provider for the tier-2 focus card — camera-frame + intrinsic
// rows only. See ./README.md § Frame-of-reference principle.

import {
  classifyFromSimbad,
  tempKelvin,
  FLAG_BINARY_COMPANION_SYNTHETIC,
  UNKNOWN_CLASS_IDX,
} from '../../../scripts/catalog/catalog-pure';
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
  formatVariability,
} from '../format/physical-format';
import { formatSpaceVelocity, spaceVelocity } from '../format/velocity-format';
import {
  companionNames,
  companionOfLines,
  resolveStarName,
} from '../format/star-companion-format';
import { spectralIsEstimated } from '../hover/formatters/star-hover-format';
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
      const raw = spectralMap.get(idx);
      const spect = spectralLine(
        formatSpectral(
          raw,
          catalog.spectClass[idx],
          catalog.luminosityClass[idx],
          spectralIsEstimated(raw, catalog.flags[idx]),
        ),
      );
      if (spect) identityLines.push(spect);

      const absmag = catalog.absmag[idx];
      const rows: FocusCardRow[] = [
        { label: 'Radius', value: formatSolarRadii(catalog.physicalRadius[idx]) },
        { label: 'Distance', value: () => fmtDistAuto(config.cameraDistancePc(idx)) },
      ];
      const teffRow = temperatureRow(catalog, idx, raw);
      if (teffRow) rows.push(teffRow);
      rows.push({ label: 'Abs mag', value: absmag.toFixed(2) });
      rows.push({
        label: 'App mag',
        value: () => appMagCameraDisplay(absmag, config.cameraDistancePc(idx)),
      });
      const variability = formatVariability(
        catalog.periodDays[idx],
        catalog.amplitudeMag[idx],
      );
      if (variability) rows.push({ label: 'Variable', value: variability });
      const vel = spaceVelocity(
        catalog.velocities[idx * 3],
        catalog.velocities[idx * 3 + 1],
        catalog.velocities[idx * 3 + 2],
      );
      if (vel) rows.push({ label: 'Velocity', value: formatSpaceVelocity(vel) });
      const names = companionNames(idx, { starLabels, binaries, nowJd: 0 });
      if (names.length > 0) {
        rows.push({ label: 'Known companions', value: names.join('\n') });
      }
      // Sol carries no survey ids by construction — a provenance row
      // would misread as Tycho-2.
      if (idx !== catalog.solIndex) {
        const prov = coarseProvenance({
          gaiaSourceId: catalog.gaiaSourceId[idx],
          hip: catalog.hip[idx],
          hd: entry?.hd,
          gl: entry?.gl,
          syntheticCompanion:
            (catalog.flags[idx] & FLAG_BINARY_COMPANION_SYNTHETIC) !== 0,
        });
        if (prov.length > 0) rows.push({ label: 'Known from', value: prov.join(' · ') });
      }
      const conIdx = catalog.constellation[idx];
      if (conIdx !== 255) {
        rows.push({ label: 'Constellation', value: catalog.constellations[conIdx].name });
      }

      const lines: FocusCardContent['lines'] = [];
      // Live so a Tier-1 pair's ρ tracks the sim clock exactly as the
      // hover card's does — shared fields must agree between tiers.
      const orbits = () =>
        companionOfLines(idx, { starLabels, binaries, nowJd: config.nowJd() }).join('\n');
      if (orbits()) lines.push(orbits);

      return { name, identityLines, rows, lines };
    },
  };
}

/** Temperature row: measured Gaia teff when present (gspphot else
 *  gspspec), else derived from the spectral classification via the
 *  build's calibration tables, marked "~". Absent when neither exists. */
function temperatureRow(
  catalog: Catalog,
  idx: number,
  rawSpectral: string | undefined,
): FocusCardRow | null {
  const measured = !Number.isNaN(catalog.teffGspphot[idx])
    ? catalog.teffGspphot[idx]
    : catalog.teffGspspec[idx];
  if (!Number.isNaN(measured)) {
    return { label: 'Temperature', value: formatKelvin(measured) };
  }
  if (!rawSpectral) return null;
  const info = classifyFromSimbad(rawSpectral.split(/[+/]/)[0].trim());
  // Unparseable classes route to the build's neutral 5000 K row — a
  // fabricated temperature; omit the row instead.
  if (!info || (info.classIdx === UNKNOWN_CLASS_IDX && !info.isWhiteDwarf)) return null;
  return { label: 'Temperature', value: `~${formatKelvin(tempKelvin(info))}` };
}

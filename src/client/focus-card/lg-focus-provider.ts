// Local Group provider for the tier-2 focus card. See ./README.md.

import type { LgObject } from '../local-group/local-group-loader';
import { maxSemiAxisPc, minSemiAxisPc } from '../local-group/local-group-loader';
import { fmtDistAuto } from '../ui/distance-util';
import { formatAxisPair } from '../format/physical-format';
import type { FocusCardContent, FocusCardProvider, FocusCardRow } from './focus-card-types';

export interface LgFocusProviderConfig {
  /** Null when local-group.json didn't load — format() then returns an
   *  empty card (unreachable in practice; LG objects can't focus
   *  without the artifact). */
  objects: readonly LgObject[] | null;
  /** Live camera→centroid distance in the local frame, pc. */
  cameraDistancePc: (idx: number) => number;
}

const SOURCE_LABEL: Record<LgObject['source'], string> = {
  LVDB: 'Pace 2024 LVDB',
  OVERRIDE: 'Curated (SCIENCE.md)',
};

/** Far-field apparent V magnitude from the camera: the catalogued
 *  as-observed m_V scaled by 1/d² off the catalog distance. Matches
 *  the emission layer's calibration convention
 *  (docs/science-local-group.md § Local Group luminosity model);
 *  near/inside the object the point-source
 *  law overstates brightness, which is acceptable card precision. */
export function lgApparentMagFrom(mV: number, catalogDistPc: number, cameraDistPc: number): number {
  return mV + 5 * Math.log10(Math.max(cameraDistPc, 1) / catalogDistPc);
}

/** Absolute V magnitude from the catalogued apparent magnitude and
 *  distance: M = m − 5·log10(d / 10 pc). */
export function lgAbsoluteMag(mV: number, catalogDistPc: number): number {
  return mV - 5 * Math.log10(catalogDistPc / 10);
}

export function createLgFocusProvider(
  config: LgFocusProviderConfig,
): FocusCardProvider<'lg'> {
  return {
    kind: 'lg',
    format(idx: number): FocusCardContent {
      const obj = config.objects?.[idx];
      if (!obj) return { name: '', identityLines: [], rows: [], lines: [] };
      const mV = obj.emission.mV;
      const rows: FocusCardRow[] = [
        { label: 'Distance', value: () => fmtDistAuto(config.cameraDistancePc(idx)) },
        {
          label: 'Apparent mag',
          value: () =>
            lgApparentMagFrom(mV, obj.distanceFromSol, config.cameraDistancePc(idx)).toFixed(1),
        },
        { label: 'Absolute mag', value: lgAbsoluteMag(mV, obj.distanceFromSol).toFixed(1) },
        { label: 'Size', value: formatAxisPair(maxSemiAxisPc(obj), minSemiAxisPc(obj)) },
        { label: 'Known from', value: SOURCE_LABEL[obj.source] },
      ];
      const identityLines = [obj.type, ...(obj.aliases ?? [])];
      return { name: obj.name, identityLines, rows, lines: [] };
    },
  };
}

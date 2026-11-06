// CURATED_RECORDS, the curated-records source. See README.md#curated-records.

import {
  FLAG_IS_SOL,
  SOL_ABSOLUTE_V_MAGNITUDE,
  SOL_APPARENT_V_MAGNITUDE,
} from '../../../src/catalog-format/record/catalog-pure';
import { CATALOG_SCENE_EPOCH, type DirectionSolution } from '../distance/direction-cascade';
import type { OriginPlacement } from '../distance/parallax/parallax-cascade';
import type { ManifestRecord } from '../membership/membership-manifest-tsv';
import { curatedSpectralValue, type SpectralValue } from '../spectral/spectral-resolve';

export interface CuratedRecord {
  readonly placement: OriginPlacement;
  readonly vMagnitude: number;
  readonly direction: DirectionSolution;
  readonly spectral: SpectralValue;
}

/** The curated record a manifest row is, or null for a row the cascades
 *  resolve from source tables alone. */
export type CuratedRecords = (row: ManifestRecord) => CuratedRecord | null;

const SOL: CuratedRecord = {
  placement: { absoluteVMagnitude: SOL_ABSOLUTE_V_MAGNITUDE },
  vMagnitude: SOL_APPARENT_V_MAGNITUDE,
  // Arbitrary and unobservable: at distance zero the walk multiplies it to the
  // origin whatever it points at.
  direction: {
    srcRaDeg: 0, srcDecDeg: 0,
    srcEpoch: CATALOG_SCENE_EPOCH,
    srcPmraMasyr: null, srcPmdecMasyr: null,
    velVia: 'zero',
  },
  spectral: curatedSpectralValue('G2V', (m) => { throw new Error(`Sol: ${m}`); }),
};

export const CURATED_RECORDS: CuratedRecords = (row) => (row.isSol ? SOL : null);

/** The index of the one record flagged Sol. Throws on none or several: every
 *  build ships exactly one. */
export function solRecordIndex(records: readonly { readonly flags: number }[]): number {
  const found = records.flatMap((r, i) => ((r.flags & FLAG_IS_SOL) !== 0 ? [i] : []));
  if (found.length !== 1) {
    throw new Error(`Expected exactly one record flagged Sol; found ${found.length} (${found.slice(0, 10).join(', ')})`);
  }
  return found[0];
}

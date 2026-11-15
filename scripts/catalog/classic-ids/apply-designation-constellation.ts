// The record build's one remaining classic-ID step: IV/27A's constellation
// for each Bayer / Flamsteed designation, keyed on the record's HD / HIP.
// See README.md#the-designation-constellation.
import { NO_CONSTELLATION_INDEX } from '../../../src/catalog-format/record/catalog-pure';
import { CROSS_INDEX } from './cross-index-source';
import {
  buildDesignationConIndex,
  NO_DESIGNATION_CON,
  resolveDesignationConIndex,
  type DesignationCon,
  type DesignationConIndex,
} from './designation-constellation-pure';

export function loadDesignationConstellationIndex(): DesignationConIndex {
  return buildDesignationConIndex(CROSS_INDEX.read());
}

/** IV/27A's tier of the cascade: where the naming ladder starts each walked record's `desigCon`. */
export function designationConstellation(
  index: DesignationConIndex, star: { readonly hd: number | null; readonly hip: number | null },
): DesignationCon {
  const conIndex = resolveDesignationConIndex(index, star.hd, star.hip);
  return conIndex === NO_CONSTELLATION_INDEX ? NO_DESIGNATION_CON : { via: 'iv27a', index: conIndex };
}

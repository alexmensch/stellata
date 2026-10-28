// The record build's one remaining classic-ID pass: IV/27A's constellation
// for each Bayer / Flamsteed designation, keyed on the record's HD / HIP.
// See README.md#the-designation-constellation.
import { NO_CONSTELLATION_INDEX } from '../record/catalog-pure';
import type { Star } from '../parse/stars-parse';
import { CROSS_INDEX } from './cross-index-source';
import {
  buildDesignationConIndex,
  resolveDesignationConIndex,
  type DesignationConIndex,
} from './designation-constellation-pure';

export interface DesignationConstellationInputs {
  desigCon: DesignationConIndex;
  crossIndexUnknownCst: number;
}

export function loadDesignationConstellationInputs(): DesignationConstellationInputs {
  const { index: desigCon, counts } = buildDesignationConIndex(CROSS_INDEX.read());
  return { desigCon, crossIndexUnknownCst: counts.crossIndexUnknownCst };
}

export interface DesignationConstellationCounts {
  /** Records whose designation constellation came from IV/27A. */
  desigConFromCrossIndex: number;
  crossIndexUnknownCst: number;
}

/** Write the constellation a Bayer / Flamsteed designation is NAMED for, which
 *  is fixed by nomenclature and does not migrate when proper motion carries the
 *  star across a 1930 boundary. Runs before companion promotion, so a promoted
 *  companion composes its name off an anchor already carrying it; the GCVS
 *  pass overwrites it downstream where a variable's own designation carries one. */
export function applyDesignationConstellations(
  stars: Star[],
  inputs: DesignationConstellationInputs,
): DesignationConstellationCounts {
  let desigConFromCrossIndex = 0;
  for (const star of stars) {
    const conIndex = resolveDesignationConIndex(inputs.desigCon, star.hd, star.hip);
    if (conIndex === NO_CONSTELLATION_INDEX) continue;
    star.desigConIndex = conIndex;
    desigConFromCrossIndex++;
  }
  return { desigConFromCrossIndex, crossIndexUnknownCst: inputs.crossIndexUnknownCst };
}

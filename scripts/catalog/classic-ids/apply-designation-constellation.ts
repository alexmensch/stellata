// The record build's one remaining classic-ID pass: IV/27A's constellation
// for each Bayer / Flamsteed designation, keyed on the record's HD / HIP.
// See README.md#the-designation-constellation.
import { NO_CONSTELLATION_INDEX } from '../../../src/catalog-format/record/catalog-pure';
import type { Star } from '../parse/stars-parse';
import { CROSS_INDEX } from './cross-index-source';
import {
  buildDesignationConIndex,
  resolveDesignationConIndex,
  type DesignationConIndex,
} from './designation-constellation-pure';

export function loadDesignationConstellationIndex(): DesignationConIndex {
  return buildDesignationConIndex(CROSS_INDEX.read());
}

/** Write the constellation a Bayer / Flamsteed designation is NAMED for, which
 *  is fixed by nomenclature and does not migrate when proper motion carries the
 *  star across a 1930 boundary. Runs before companion promotion, so a promoted
 *  companion composes its name off an anchor already carrying it; the GCVS
 *  pass overwrites it downstream where a variable's own designation carries one. */
export function applyDesignationConstellations(stars: Star[], index: DesignationConIndex): void {
  for (const star of stars) {
    const conIndex = resolveDesignationConIndex(index, star.hd, star.hip);
    if (conIndex === NO_CONSTELLATION_INDEX) continue;
    star.desigCon = { via: 'iv27a', index: conIndex };
  }
}

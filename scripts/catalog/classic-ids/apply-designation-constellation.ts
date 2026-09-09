// The record build's one remaining classic-ID pass: IV/27A's constellation
// for each Bayer / Flamsteed designation, keyed on the record's HD / HIP.
// See README.md § The designation constellation.
import { existsSync } from 'node:fs';

import { NO_CONSTELLATION_INDEX } from '../catalog-pure';
import type { Star } from '../parse/stars-parse';
import {
  CROSS_INDEX_INPUT_PATHS,
  SRC_CROSS_INDEX,
  readCrossIndexTable,
} from './cross-index';
import {
  buildDesignationConIndex,
  resolveDesignationConIndex,
  type DesignationConIndex,
} from './designation-constellation-pure';

/** The pass's inputs, for the artifact's mtime invalidation. */
export const DESIGNATION_CONSTELLATION_INPUT_PATHS = CROSS_INDEX_INPUT_PATHS;

export interface DesignationConstellationInputs {
  desigCon: DesignationConIndex;
  crossIndexUnknownCst: number;
}

/** IV/27A is a committed artifact and not optional: without it every Bayer /
 *  Flamsteed designation would fall back to its positional constellation — the
 *  ρ Aql rewrite. A missing file is a hard fail rather than a degraded tier,
 *  the same call `loadReadStarsInputs` makes for the dust grid. */
export function loadDesignationConstellationInputs(): DesignationConstellationInputs {
  if (!existsSync(SRC_CROSS_INDEX)) {
    throw new Error(
      `Missing ${SRC_CROSS_INDEX}. Confirm git LFS is pulled (\`git lfs pull\`), then ` +
        `re-run \`pnpm run refresh:classic-ids\`.`,
    );
  }
  const { index: desigCon, counts } = buildDesignationConIndex(readCrossIndexTable());
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

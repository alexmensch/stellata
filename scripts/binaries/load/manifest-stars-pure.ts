// The membership manifest as Stage 2 reads it: each HIP's derived Gaia source, and every record placed by the owned position sources. See README.md#the-manifest.

import { directionAtEpoch, raDecFromUnitVector } from '../../../src/astro-core/equatorial-basis';
import { resolveDirection, type DirectionLookups } from '../../catalog/distance/direction-cascade';
import type { ManifestRecord } from '../../catalog/membership/membership-manifest-tsv';
import type { MatchStar } from '../resolve/position-match-pure';
import { WDS_PRECISE_COORD_EPOCH } from '../sky-geometry-pure';

export interface ManifestStar extends MatchStar {
  readonly gaia: string | null;
  /** The position's source states a proper motion: `position_pm`, else `position_nopm`. */
  readonly hasPm: boolean;
}

export interface ManifestIndex {
  readonly hipToGaia: ReadonlyMap<number, string>;
  readonly stars: readonly ManifestStar[];
}

/** The astrometry request's run of Stage 2: a step may not read the manifest
 *  (/scripts/pipeline/README.md#loops-through-committed-files). */
export const WITHHELD_MANIFEST: ManifestIndex = Object.freeze({ hipToGaia: new Map(), stars: Object.freeze([]) });

export type ManifestPositionSources = Pick<DirectionLookups, 'gaiaAstrometry' | 'hip2' | 'nss' | 'tycho2'>;

/** A record no source places takes no part in the match. A HIP on two records throws. */
export function buildManifestIndex(
  records: Iterable<Pick<ManifestRecord, 'hip' | 'tyc' | 'gaiaSourceId'>>, sources: ManifestPositionSources,
): ManifestIndex {
  const lookups: DirectionLookups = { ...sources, cns5: new Map() };
  const hipToGaia = new Map<number, string>();
  const seenHips = new Set<number>();
  const stars: ManifestStar[] = [];
  for (const r of records) {
    if (r.hip !== null) {
      if (seenHips.has(r.hip)) throw new Error(`membership manifest: HIP ${r.hip} on two records`);
      seenHips.add(r.hip);
      if (r.gaiaSourceId !== null) hipToGaia.set(r.hip, r.gaiaSourceId);
    }
    const resolved = resolveDirection(
      { sourceId: r.gaiaSourceId, hip: r.hip, tyc: r.tyc, gl: null, simbad: null, curated: null }, lookups,
    );
    if (resolved.via === 'none') continue;
    const s = resolved.value;
    const atWds = directionAtEpoch(
      { raDeg: s.srcRaDeg, decDeg: s.srcDecDeg }, { pmRaMasyr: s.srcPmraMasyr, pmDecMasyr: s.srcPmdecMasyr },
      s.srcEpoch, WDS_PRECISE_COORD_EPOCH,
    );
    const { raDeg, decDeg } = raDecFromUnitVector(atWds);
    stars.push({
      raDeg, decDeg, hip: r.hip, gaia: r.gaiaSourceId, readings: [atWds],
      hasPm: s.srcPmraMasyr !== null && s.srcPmdecMasyr !== null,
    });
  }
  return { hipToGaia, stars };
}

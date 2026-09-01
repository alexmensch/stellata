// A bound pair's own clean sibling parallax, offered to the member Gaia
// fitted none for. Index over multiples.tsv × the DR3 astrometry table; the
// cascade tier that reads it is in parallax-cascade.ts. See README.md.

import type { GaiaAstrometryCatalogRow } from '../direction-cascade';
import type { MultiplesTsvRow } from '../../companions/companion-promotion';
import { wdsRootOf } from '../../companions/companion-promotion';
import { isCoherenceAnchorGrade } from '../../multiplicity/system-coherence';
import { belowParallaxSnFloor, parallaxSignalToNoise } from './parallax-cascade';

/** One sibling's parallax, with the DR3 source it was measured on. */
export interface SiblingParallax {
  sourceId: string;
  mas: number;
  errMas: number | null;
}

export interface PairMemberParallaxIndex {
  /** Every identifier a spine row can ask with → the WDS root holding it. */
  rootByGaia: Map<string, string>;
  rootByHip: Map<number, string>;
  /** Per root, the anchor-grade member parallaxes, most precise first. */
  candidatesByRoot: Map<string, SiblingParallax[]>;
  /** Anchor-grade siblings indexed, for the build-count pin. */
  entryCount: number;
}

export function emptyPairMemberParallaxIndex(): PairMemberParallaxIndex {
  return {
    rootByGaia: new Map(),
    rootByHip: new Map(),
    candidatesByRoot: new Map(),
    entryCount: 0,
  };
}

/** Sort key for "most precise sibling first". A sibling stating no error bar
 *  clears the floor (`belowParallaxSnFloor`) but cannot be ranked against one
 *  that does, so it sorts last rather than best. */
function precisionRank(s: SiblingParallax): number {
  return parallaxSignalToNoise(s.mas, s.errMas) ?? -Infinity;
}

/** Every source the sibling tier may read a parallax from — the pair-row half
 *  of the astrometry request (`../../astrometry-request/README.md`).
 *
 *  Deliberately every kept-physical pair member rather than only the roots
 *  holding a parked row: which rows park is an output of the build the request
 *  feeds, so keying the request on it would make the two define each other and
 *  leave the set unstable under any cascade change. */
export function pairMemberSourceIds(
  multiplesRows: readonly MultiplesTsvRow[],
): Set<string> {
  const ids = new Set<string>();
  for (const row of multiplesRows) {
    if (row.orbitRole === 'standalone') continue;
    if (wdsRootOf(row.systemId) === null) continue;
    if (row.gaiaSourceId !== null) ids.add(row.gaiaSourceId);
  }
  return ids;
}

/** Index the kept-physical pair rows of `multiples.tsv` by WDS root, carrying
 *  each root's anchor-grade member parallaxes.
 *
 *  A member's parallax is read on its OWN `gaia_source_id`, which is what keeps
 *  the index honest: Stage 2/3 bind one blended source to every component of a
 *  sub-arcsec pair, so a root's rows routinely repeat the primary's id. Reading
 *  the astrometry table on that id twice would offer a member the fit it
 *  already carries rather than a sibling's, and the duplicate is dropped here
 *  by source_id.
 *
 *  Physicality is inherited from Stage 5 exactly as the coherence pass inherits
 *  it: pair rows ARE the kept-physical set, and standalone rows never
 *  participate. */
export function buildPairMemberParallaxIndex(
  multiplesRows: readonly MultiplesTsvRow[],
  gaiaAstrometry: ReadonlyMap<string, GaiaAstrometryCatalogRow>,
): PairMemberParallaxIndex {
  const index = emptyPairMemberParallaxIndex();
  const seenSource = new Map<string, Set<string>>();
  for (const row of multiplesRows) {
    if (row.orbitRole === 'standalone') continue;
    const root = wdsRootOf(row.systemId);
    if (root === null) continue;
    if (row.gaiaSourceId !== null) index.rootByGaia.set(row.gaiaSourceId, root);
    if (row.hip !== null && row.hip > 0) index.rootByHip.set(row.hip, root);

    if (row.gaiaSourceId === null) continue;
    let seen = seenSource.get(root);
    if (seen === undefined) {
      seen = new Set();
      seenSource.set(root, seen);
    }
    if (seen.has(row.gaiaSourceId)) continue;
    seen.add(row.gaiaSourceId);
    const g = gaiaAstrometry.get(row.gaiaSourceId);
    // `isCoherenceAnchorGrade` requires a positive parallax, so the null check
    // is redundant to it — stated anyway, because a cast here would be the one
    // place this module trusts another module's predicate to narrow a type.
    if (g === undefined || g.parallaxMas === null || !isCoherenceAnchorGrade(g)) {
      continue;
    }
    const candidate: SiblingParallax = {
      sourceId: row.gaiaSourceId,
      mas: g.parallaxMas,
      errMas: g.parallaxErrorMas,
    };
    // Below the floor the inversion is undefined, so such a sibling anchors
    // nothing — the same bar, from the same predicate, the HIP2 tier applies to
    // a record's own parallax.
    if (belowParallaxSnFloor(candidate.mas, candidate.errMas)) continue;
    let candidates = index.candidatesByRoot.get(root);
    if (candidates === undefined) {
      candidates = [];
      index.candidatesByRoot.set(root, candidates);
    }
    candidates.push(candidate);
    index.entryCount++;
  }
  for (const candidates of index.candidatesByRoot.values()) {
    candidates.sort((a, b) => precisionRank(b) - precisionRank(a)
      || a.sourceId.localeCompare(b.sourceId));
  }
  return index;
}

/** The best anchor-grade parallax a record's own bound siblings measured.
 *
 *  `ownSourceId` is excluded rather than assumed absent: a record reaching this
 *  tier has no usable own Gaia parallax today (the inversion tier fires first),
 *  but that is a property of the cascade order rather than of this index. */
export function lookupPairMemberParallax(
  index: PairMemberParallaxIndex,
  ownSourceId: string | null,
  hip: number | null,
): SiblingParallax | null {
  const root = (ownSourceId !== null ? index.rootByGaia.get(ownSourceId) : undefined)
    ?? (hip !== null ? index.rootByHip.get(hip) : undefined);
  if (root === undefined) return null;
  for (const candidate of index.candidatesByRoot.get(root) ?? []) {
    if (candidate.sourceId !== ownSourceId) return candidate;
  }
  return null;
}

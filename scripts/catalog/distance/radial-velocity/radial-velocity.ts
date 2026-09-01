// The radial-velocity cascade: Gaia DR3 RVS on a 5p row → bibcoded SIMBAD
// → zero radial term, with the Gaia-bibcode skip rule. See README.md.

import {
  VELOCITY_SANITY_CEILING_KM_S,
  type GaiaAstrometryCatalogRow,
} from '../direction-cascade';
import {
  gaiaHas5pSolution,
  gaiaRowIs2p,
  isGaiaCatalogueBibcode,
} from '../gaia-distrust';
import type { SimbadRadialVelocity } from '../../simbad-values-parse';

// Which source supplied the radial term of the space-motion velocity. Pinned
// per-tier in build-counts alongside `velocityVia`, which covers the
// tangential term.
export const RV_VIA_VALUES = [
  'gaia_dr3',
  'simbad',
  'none',
] as const;

export type RvVia = (typeof RV_VIA_VALUES)[number];

// Coarse `radial_velocity_error` spread over the rows the Gaia tier supplies,
// pinned in build-counts. Nothing routes on it — README.md § radial_velocity_error.
export const RV_ERROR_BANDS = [
  'none',
  'le1',
  'le5',
  'le10',
  'le20',
  'gt20',
] as const;

export type RvErrorBand = (typeof RV_ERROR_BANDS)[number];

export type RvErrorBandPartition = Record<RvErrorBand, number>;

const RV_ERROR_BAND_EDGES_KM_S: ReadonlyArray<readonly [number, RvErrorBand]> = [
  [1, 'le1'],
  [5, 'le5'],
  [10, 'le10'],
  [20, 'le20'],
];

/** Band for one row's stated rv uncertainty. `none` is the shape the
 *  published catalogue never carries — an rv with no error — and is pinned
 *  at 0. */
export function rvErrorBand(errorKmS: number | null): RvErrorBand {
  if (errorKmS === null) return 'none';
  for (const [edge, band] of RV_ERROR_BAND_EDGES_KM_S) {
    if (errorKmS <= edge) return band;
  }
  return 'gt20';
}

/** Whether a radial term alone is past the space-velocity sanity ceiling.
 *  Rejecting just this term leaves the row its measured proper motion, which
 *  the whole-vector clamp would otherwise take with it — README.md § The
 *  sanity thresholds. */
export function radialTermExceedsCeiling(rvKmS: number | null): boolean {
  return rvKmS !== null && Math.abs(rvKmS) > VELOCITY_SANITY_CEILING_KM_S;
}

export interface RadialVelocityResolution {
  /** km/s, or null when no tier carries one — the radial term is then zero. */
  rvKmS: number | null;
  via: RvVia;
  /** The bibcode the shipped value cites. Set on the `simbad` tier only —
   *  the Gaia tier's citation is the release itself. */
  bibcode: string | null;
  /** The shipped value cites a Gaia release. Sibling of the field below: this
   *  row is not the blend the skip rule refuses, so the citation is ordinary. */
  gaiaBibcodeCited: boolean;
  /** A SIMBAD value the Gaia-bibcode skip rule rejected on this row. */
  gaiaBibcodeSkipped: boolean;
}

/** Radial velocity through the cascade: Gaia DR3 `radial_velocity` on a 5p
 *  row → SIMBAD `rvz_radvel` (bibcoded) → zero radial term.
 *  `docs/catalog-driver.md` § 5.
 *
 *  The Gaia tier needs a 5p solution, not merely an `rv` cell: RVS measures the
 *  same window the astrometric fit does, so a row Gaia could not separate into
 *  parallax + PM is one whose spectrum is a blend of the components too, and its
 *  median RV is not the primary's. See README.md § The 5p gate.
 *
 *  **The skip rule** closes the way back in. SIMBAD frequently serves a
 *  Gaia-bibcoded velocity for a 2p row — the same blended spectrum under
 *  Gaia's own reduction — so taking it would launder in a value this build
 *  distrusts for a physical reason. Those candidates fall to zero rather than
 *  to SIMBAD. It turns on the blend, not on whether our own pull happens to
 *  hold the competing Gaia value. See README.md § The Gaia-bibcode skip rule. */
export function resolveRadialVelocity(
  gaia: GaiaAstrometryCatalogRow | null,
  simbad: SimbadRadialVelocity | null,
): RadialVelocityResolution {
  const none: RadialVelocityResolution = {
    rvKmS: null, via: 'none', bibcode: null,
    gaiaBibcodeCited: false, gaiaBibcodeSkipped: false,
  };
  if (gaia !== null && gaiaHas5pSolution(gaia) && gaia.radialVelocityKmS !== null) {
    return { ...none, rvKmS: gaia.radialVelocityKmS, via: 'gaia_dr3' };
  }
  if (gaiaRowIs2p(gaia)
      && simbad !== null && isGaiaCatalogueBibcode(simbad.bibcode)) {
    return { ...none, gaiaBibcodeSkipped: true };
  }
  if (simbad !== null) {
    return {
      ...none, rvKmS: simbad.kmS, via: 'simbad', bibcode: simbad.bibcode,
      gaiaBibcodeCited: isGaiaCatalogueBibcode(simbad.bibcode),
    };
  }
  return none;
}

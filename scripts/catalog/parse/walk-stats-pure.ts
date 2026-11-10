// The readStars walk's counts, folded one RowOutcome at a time. See README.md#per-row-pipeline.

import { DIST_VIA_VALUES, type DistVia } from '../../../src/catalog-format/record/catalog-pure';
import { SIMBAD_NAMESPACE_VALUES, type SimbadNamespace } from '../simbad/simbad-namespace-ladder-pure';
import { SPECTRAL_VIA_VALUES, type SpectralVia } from '../spectral/spectral-resolve';
import { DIRECTION_VIA_VALUES, type DirectionVia } from '../distance/direction-cascade';
import { VELOCITY_VIA_VALUES, type VelocityVia } from '../distance/velocity';
import { isGaiaCatalogueBibcode } from '../distance/gaia-distrust';
import { isLowPrecisionParallax } from '../distance/parallax/parallax-cascade';
import { PARKED_REASONS, type ParkedReason, type ParkedRecord } from '../distance/parallax/parked-ledger-pure';
import {
  distViaBeforeLmc, parkedRecord, radialVelocityApplied, shippedDistVia, shippedVelocityVia, type PlacedPlacement,
} from '../distance/placement-lineage-pure';
import { PM_RESCUE_OUTCOMES, pmRescueOutcome, type PmRescueOutcome } from '../distance/pm-rescue/pm-rescue';
import { RV_VIA_VALUES, RV_ERROR_BANDS, type RvVia, type RvErrorBand } from '../distance/radial-velocity/radial-velocity';
import { V_VIA_VALUES, type VVia } from '../photometry/v-magnitude-pure';
import { CI_VIA_VALUES, type CiVia } from '../photometry/colour-index-pure';
import { emptyTallyPartition } from '../../util/counts/tally-pure';
import type { RowOutcome, Star } from './stars-parse';

export const VELOCITY_ABOVE_ESCAPE_SAMPLE_CAP = 25;

export interface WalkStats {
  total: number;
  /** Rows carrying a source_id whose parallax cascade resolved
   *  `gaia_dr3_inversion` — the tier B-J publishes a posterior over. */
  bjEligible: number;
  bjOverridden: number;          // bjEligible rows that hit a B-J entry
  /** The record-parity dropped list (/docs/catalog-driver.md#61-record-parity) — enumerated, because these rows leave the
   *  catalogue and nothing else records that they existed. */
  parked: ParkedRecord[];
  /** The same rows counted per reason; which rows each partition runs over:
   *  README.md#per-row-pipeline. */
  parkedVia: Record<ParkedReason, number>;
  /** Rows whose SHIPPED distance inverts a parallax with worse than 20%
   *  fractional error, so the result is biased. They ship — no second source
   *  reaches them — and this count is how they stay visible for a Gaia DR4
   *  revisit. Bailer-Jones 2021
   *  (/data/papers/index.md#bailerjones2021) rows are excluded: there the
   *  posterior, not the inversion, handles the low-S/N case. */
  distLowPrecisionParallax: number;
  distVia: Record<DistVia, number>;
  lmcCandidates: number;         // rows inside the LMC sky cone (any PM)
  lmcOverridden: number;         // lmcCandidates passing the PM gate (snapped to LMC)
  /** PM-gate passes whose own parallax rules the LMC out, by the tier kept. */
  lmcParallaxRefusedByDistVia: Record<DistVia, number>;
  /** lmcOverridden split by the tier the snap displaced — which populations
   *  the override actually moves. */
  lmcOverriddenByDistVia: Record<DistVia, number>;
  directionVia: Record<DirectionVia, number>; // per-tier direction-cascade routing
  vVia: Record<VVia, number>;    // per-tier V-magnitude cascade routing
  // tycho2-tier rows outside BT−VT ∈ [−0.25, 2.0], wider than ESA 1997
  // (/data/papers/index.md#esa1997) SP-1200's published −0.2 … 1.8
  vTycho2OutsideBtVtRange: number;
  directionTycho2FromIcrs: number;    // tycho2-tier rows placed at the J2000 cell, no mean solution
  directionTycho2Photocentre: number; // tycho2-tier rows whose mean solution is a double's photocentre
  velocityVia: Record<VelocityVia, number>;   // per-tier space-motion PM-source routing
  pmRescueOutcome: Record<PmRescueOutcome, number>;   // rescue-cascade routing over the rows the direction tier left without a PM
  velocityClamped: number;       // rows whose artifact velocity exceeded the sanity ceiling → zeroed
  velocityClampedSample: string[]; // per-clamped-star "id: speed @ dist" for build-log review
  velocityAboveEscape: number;   // kept rows above the Galactic escape velocity (tracked ratchet)
  velocityAboveEscapeSample: string[]; // capped sample of above-escape stars for build-log review
  rvVia: Record<RvVia, number>;  // per-tier radial-velocity cascade routing
  rvSimbadGaiaBibcode: number;   // simbad-tier rows citing a Gaia catalogue release
  rvGaiaBibcodeSkipped: number;  // 2p rows whose Gaia-bibcoded SIMBAD value the skip rule rejected
  rvRadialRejected: number;      // rows whose radial term alone exceeded the sanity ceiling
  rvRadialRejectedSample: string[]; // per-rejected-star "id: rv @ dist" for build-log review
  rvGaiaErrorBand: Record<RvErrorBand, number>; // gaia_dr3-tier rows by stated rv uncertainty
  rvGaiaErrorMaxKmS: number;     // largest stated rv uncertainty on a gaia_dr3-tier row
  rvApplied: number;             // rows whose velocity carries a non-zero radial velocity
  spectralVia: Record<SpectralVia, number>; // per-tier spectral resolver routing; none renders as SPECTRAL_UNKNOWN
  spectralSimbadKey: Record<SimbadNamespace, number>; // which namespace found a SIMBAD-tier row
  ciVia: Record<CiVia, number>;  // per-tier B−V cascade routing
  ciGspcValidatedRange: number;  // gspc-tier rows the archive calls in-range
}

/** Counted against the SHIPPED tier, not the resolved parallax: where
 *  Bailer-Jones supersedes the inversion its posterior is what handles a
 *  low-S/N parallax, and the LMC snap replaces the distance outright. */
function shipsLowPrecisionParallax(p: PlacedPlacement): boolean {
  return p.parallax.via !== 'curated'
    && isLowPrecisionParallax(p.parallax.value) && shippedDistVia(p) === p.parallax.via;
}

function sampleLabel({ proper, hip, gaiaSourceId }: Star): string {
  return proper ?? (hip !== null ? `HIP ${hip}` : gaiaSourceId ? `Gaia ${gaiaSourceId}` : '(anon)');
}

/** A streaming fold, so the walk holds no outcome past its own row. */
export function walkStatsFold(): { add(outcome: RowOutcome): void; result(): WalkStats } {
  const stats: WalkStats = {
    total: 0,
    bjEligible: 0,
    bjOverridden: 0,
    parked: [],
    parkedVia: emptyTallyPartition(PARKED_REASONS),
    distLowPrecisionParallax: 0,
    distVia: emptyTallyPartition(DIST_VIA_VALUES),
    lmcCandidates: 0,
    lmcOverridden: 0,
    lmcParallaxRefusedByDistVia: emptyTallyPartition(DIST_VIA_VALUES),
    lmcOverriddenByDistVia: emptyTallyPartition(DIST_VIA_VALUES),
    directionVia: emptyTallyPartition(DIRECTION_VIA_VALUES),
    vVia: emptyTallyPartition(V_VIA_VALUES),
    vTycho2OutsideBtVtRange: 0,
    directionTycho2FromIcrs: 0,
    directionTycho2Photocentre: 0,
    velocityVia: emptyTallyPartition(VELOCITY_VIA_VALUES),
    pmRescueOutcome: emptyTallyPartition(PM_RESCUE_OUTCOMES),
    velocityClamped: 0,
    velocityClampedSample: [],
    velocityAboveEscape: 0,
    velocityAboveEscapeSample: [],
    rvVia: emptyTallyPartition(RV_VIA_VALUES),
    rvSimbadGaiaBibcode: 0,
    rvGaiaBibcodeSkipped: 0,
    rvRadialRejected: 0,
    rvRadialRejectedSample: [],
    rvGaiaErrorBand: emptyTallyPartition(RV_ERROR_BANDS),
    rvGaiaErrorMaxKmS: 0,
    rvApplied: 0,
    spectralVia: emptyTallyPartition(SPECTRAL_VIA_VALUES),
    spectralSimbadKey: emptyTallyPartition(SIMBAD_NAMESPACE_VALUES),
    ciVia: emptyTallyPartition(CI_VIA_VALUES),
    ciGspcValidatedRange: 0,
  };

  const addRv = ({ resolution, gaiaError }: RowOutcome['rv']): void => {
    stats.rvVia[resolution.via]++;
    if (resolution.via === 'simbad' && isGaiaCatalogueBibcode(resolution.value.bibcode)) stats.rvSimbadGaiaBibcode++;
    if (resolution.refusals.some((r) => r.tier === 'simbad')) stats.rvGaiaBibcodeSkipped++;
    if (gaiaError !== null) {
      stats.rvGaiaErrorBand[gaiaError.band]++;
      if (gaiaError.kmS !== null && gaiaError.kmS > stats.rvGaiaErrorMaxKmS) stats.rvGaiaErrorMaxKmS = gaiaError.kmS;
    }
  };

  const addShipped = (o: Extract<RowOutcome, { kind: 'shipped' }>): void => {
    const { placement: p, brightness: b, facts: f } = o;
    const fastSample = (kmS: number): string =>
      `${sampleLabel(o.star)}: ${kmS.toFixed(0)} km/s @ ${f.distPc.toFixed(0)} pc`;
    if (f.bailerJonesEligible) stats.bjEligible++;
    if (p.bailerJones.kind === 'override') stats.bjOverridden++;
    if (f.inLmcCone) stats.lmcCandidates++;
    if (p.lmc === 'snap') {
      stats.lmcOverridden++;
      stats.lmcOverriddenByDistVia[distViaBeforeLmc(p)]++;
    } else if (p.lmc === 'parallax_rules_out') {
      stats.lmcParallaxRefusedByDistVia[distViaBeforeLmc(p)]++;
    }
    stats.distVia[shippedDistVia(p)]++;
    if (shipsLowPrecisionParallax(p)) stats.distLowPrecisionParallax++;
    stats.directionVia[p.direction.via]++;
    if (f.tycho2Direction !== null) {
      if (f.tycho2Direction.fromIcrs) stats.directionTycho2FromIcrs++;
      if (f.tycho2Direction.isPhotocentre) stats.directionTycho2Photocentre++;
    }
    if (p.pmRescue !== null) stats.pmRescueOutcome[pmRescueOutcome(p.pmRescue)]++;
    stats.vVia[b.v.via]++;
    if (f.vTycho2OutsideBtVtRange) stats.vTycho2OutsideBtVtRange++;
    if (p.rv.kind === 'rejected') {
      stats.rvRadialRejected++;
      stats.rvRadialRejectedSample.push(
        `${sampleLabel(o.star)}: ${p.rv.rv.value.kmS.toFixed(1)} km/s @ ${f.distPc.toFixed(1)} pc`,
      );
    }
    if (p.velocityClamped) {
      if (f.fastKmS === null) throw new Error(`walk stats: ${p.key} clamped below the escape velocity`);
      stats.velocityClamped++;
      stats.velocityClampedSample.push(fastSample(f.fastKmS));
    } else if (f.fastKmS !== null) {
      stats.velocityAboveEscape++;
      if (stats.velocityAboveEscapeSample.length < VELOCITY_ABOVE_ESCAPE_SAMPLE_CAP) {
        stats.velocityAboveEscapeSample.push(fastSample(f.fastKmS));
      }
    }
    stats.velocityVia[shippedVelocityVia(p)]++;
    if (radialVelocityApplied(p)) stats.rvApplied++;
    stats.spectralVia[b.spectral.via]++;
    if (b.spectral.via === 'simbad') stats.spectralSimbadKey[b.spectral.value.namespace]++;
    stats.ciVia[b.ci.via]++;
    if (f.ciGspcValidatedRange) stats.ciGspcValidatedRange++;
  };

  return {
    add(outcome) {
      stats.total++;
      addRv(outcome.rv);
      if (outcome.kind === 'shipped') {
        addShipped(outcome);
        return;
      }
      const park = parkedRecord(outcome.placement);
      stats.parked.push(park);
      stats.parkedVia[park.reason]++;
    },
    result: () => stats,
  };
}

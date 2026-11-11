// Stage 5: every pair classified physical or optical, keyed by DecomposedPair, and the counts it completes. See README.md.

import { fold, prefixed, share, sumOf } from '../../util/counts/tally-pure';
import { groupBy } from '../../util/map-buckets-pure';
import type { Stage3Result } from '../astrometry/attach-astrometry';
import { systemParallaxAnchors, systemPmAnchors } from '../astrometry/system-anchors-pure';
import type { IdentifierIndices } from '../load/indices-pure';
import type { Stage4Result } from '../orbits/attach-orbits';
import type { DecomposedPair } from '../resolve/components-pure';
import { classifyPairOptical, OPTICAL_REJECT_VIA, OPTICAL_VIA, type OpticalVia } from './optical-tiers-pure';
import { orbitalPmBudgetKmS } from './pm-budget-pure';

export interface Stage5Result {
  /** One per Stage 3 pair. */
  readonly optical: ReadonlyMap<DecomposedPair, OpticalVia>;
}

/** `masses` is each pair's total mass in M☉ (`../masses/`). */
export function attachStage5(
  stage3: Stage3Result, stage4: Stage4Result, masses: ReadonlyMap<DecomposedPair, number>, indices: IdentifierIndices,
): Stage5Result {
  const parallaxAnchors = systemParallaxAnchors(stage3.pairs, stage3.astrometry);
  const pmAnchors = systemPmAnchors(stage3.pairs, stage3.astrometry);
  const bySystem = groupBy(stage3.pairs, (p) => p.pair.wdsId);
  const optical = new Map<DecomposedPair, OpticalVia>();
  for (const p of stage3.pairs) {
    const wdsId = p.pair.wdsId;
    const systemParallax = parallaxAnchors.get(wdsId) ?? null;
    optical.set(p, classifyPairOptical(p, {
      orbitVia: stage4.orbits.get(p)!.orbitVia,
      astrometry: stage3.astrometry.get(p)!,
      systemParallax,
      systemPm: pmAnchors.get(wdsId) ?? null,
      totalMassMsun: masses.get(p)!,
      orbitalPmBudgetKmS: orbitalPmBudgetKmS(p, bySystem.get(wdsId)!, stage4.orbits, masses, systemParallax?.parallaxMas ?? null),
    }, indices));
  }
  return Object.freeze({ optical });
}

export function opticalTally(result: Stage5Result): Record<OpticalVia, number> {
  return fold(OPTICAL_VIA, result.optical.values(), (v) => v);
}

export type Stage5Counts = Record<`optical_${OpticalVia}`, number>;

export function stage5Counts(result: Stage5Result): Stage5Counts {
  return prefixed('optical_', opticalTally(result));
}

export function opticalRejected(counts: Stage5Counts): number {
  return sumOf(counts, 'optical_', OPTICAL_REJECT_VIA);
}

/** The share of pairs Stage 5 rejected. */
export function stage5Rates(counts: Stage5Counts): Record<'optical_rejected_rate', number> {
  const total = sumOf(counts, 'optical_', OPTICAL_VIA);
  return { optical_rejected_rate: share(opticalRejected(counts), total, 'optical_rejected_rate') };
}

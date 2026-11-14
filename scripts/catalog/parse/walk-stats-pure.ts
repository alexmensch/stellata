// The readStars walk's counts, folded one RowOutcome at a time. See README.md#per-row-pipeline.

import { parkedRecord } from '../distance/placement-lineage-pure';
import { placementDerivedFold, type PlacementDerivedCounts } from '../distance/placement-counts-pure';
import type { ParkedRecord } from '../distance/parallax/parked-ledger-pure';
import type { RowOutcome, Star } from './stars-parse';

export const VELOCITY_ABOVE_ESCAPE_SAMPLE_CAP = 25;

export interface WalkStats {
  total: number;
  /** The record-parity dropped list (/docs/catalog-driver.md#61-record-parity) — enumerated, because these rows leave the
   *  catalogue and nothing else records that they existed. */
  parked: ParkedRecord[];
  placementDerived: PlacementDerivedCounts;
  velocityClampedSample: string[];    // per-clamped-star "id: speed @ dist" for build-log review
  velocityAboveEscapeSample: string[]; // capped sample of above-escape stars for build-log review
  rvRadialRejectedSample: string[];   // per-rejected-star "id: rv @ dist" for build-log review
}

function sampleLabel({ proper, hip, gaiaSourceId }: Star): string {
  return proper ?? (hip !== null ? `HIP ${hip}` : gaiaSourceId ? `Gaia ${gaiaSourceId}` : '(anon)');
}

/** A streaming fold, so the walk holds no outcome past its own row. */
export function walkStatsFold(): { add(outcome: RowOutcome): void; result(): WalkStats } {
  let total = 0;
  const parked: ParkedRecord[] = [];
  const derived = placementDerivedFold();
  const velocityClampedSample: string[] = [];
  const velocityAboveEscapeSample: string[] = [];
  const rvRadialRejectedSample: string[] = [];

  const addShipped = (o: Extract<RowOutcome, { kind: 'shipped' }>): void => {
    const { placement: p, facts: f } = o;
    derived.add(p);
    const sample = (kmS: number): string => `${sampleLabel(o.star)}: ${kmS.toFixed(0)} km/s @ ${f.distPc.toFixed(0)} pc`;
    if (p.rv.kind === 'rejected') {
      rvRadialRejectedSample.push(`${sampleLabel(o.star)}: ${p.rv.rv.value.kmS.toFixed(1)} km/s @ ${f.distPc.toFixed(1)} pc`);
    }
    if (p.speed === 'clamped') velocityClampedSample.push(sample(f.speedKmS));
    if (p.speed === 'above_escape' && velocityAboveEscapeSample.length < VELOCITY_ABOVE_ESCAPE_SAMPLE_CAP) {
      velocityAboveEscapeSample.push(sample(f.speedKmS));
    }
  };

  return {
    add(outcome) {
      total++;
      if (outcome.kind === 'shipped') addShipped(outcome);
      else parked.push(parkedRecord(outcome.placement));
    },
    result: () => ({
      total, parked, placementDerived: derived.result(),
      velocityClampedSample, velocityAboveEscapeSample, rvRadialRejectedSample,
    }),
  };
}

import { describe, expect, it } from 'vitest';

import { sourceRowRef } from '../../util/sources/row-ref-pure';
import { GLIESE } from '../gliese-source';
import { TYCHO2 } from '../tycho2-source';
import { BAILER_JONES } from '../distance/refinement/bailer-jones-source';
import type { ParkedPlacement, PlacedPlacement } from '../distance/placement-lineage-pure';
import type { ShippedBrightness } from '../photometry/brightness-colour-lineage-pure';
import { SPECTRAL_UNKNOWN } from '../../../src/catalog-format/spectral/spectral-classify';
import { physicalRadius } from '../../../src/catalog-format/spectral/physical-radius';
import { makeStar } from './star-fixture';
import type { RowOutcome, RvRouting, ShippedFacts } from './stars-parse';
import { VELOCITY_ABOVE_ESCAPE_SAMPLE_CAP, walkStatsFold, type WalkStats } from './walk-stats-pure';

const GL_REF = sourceRowRef(GLIESE, '901');
const TYC_REF = sourceRowRef(TYCHO2, '1-1-1');
const BJ_REF = sourceRowRef(BAILER_JONES, '1');
const NO_RV: RvRouting = { resolution: { via: 'none', refusals: [] }, gaiaError: null };
const IDS = { tyc: null, hip: null, hd: null, gl: '901', gaiaSourceId: null };

const glieseParallax = (errMas: number): PlacedPlacement['parallax'] => (
  { via: 'gliese_plx', value: { mas: 10, errMas }, evidence: [GL_REF], refusals: [] }
);

const PLACED: PlacedPlacement = {
  kind: 'placed',
  key: 'spine:1',
  parallax: glieseParallax(0.01),
  direction: {
    via: 'tycho2',
    value: { srcRaDeg: 0, srcDecDeg: 0, srcEpoch: 2000, srcPmraMasyr: 1, srcPmdecMasyr: 1, velVia: 'tycho2_pm' },
    evidence: [TYC_REF],
    refusals: [],
  },
  pmRescue: null,
  bailerJones: { kind: 'not-applied' },
  lmc: 'not_member',
  rv: { kind: 'kept', rv: { via: 'none', refusals: [] } },
  velocityClamped: false,
};
const BRIGHTNESS: ShippedBrightness = {
  kind: 'shipped', key: 'spine:1',
  v: { via: 'tycho2', value: { vMag: 10, outsideRange: false }, evidence: [TYC_REF], refusals: [] },
  spectral: { via: 'none', refusals: [] },
  ci: { via: 'none', refusals: [] },
  dust: null,
};
const FACTS: ShippedFacts = {
  bailerJonesEligible: false,
  inLmcCone: false,
  tycho2Direction: null,
  vTycho2OutsideBtVtRange: false,
  distPc: 100,
  fastKmS: null,
};

const shipped = (
  placement: Partial<PlacedPlacement> = {}, facts: Partial<ShippedFacts> = {},
): RowOutcome => ({
  kind: 'shipped',
  placement: { ...PLACED, ...placement },
  brightness: BRIGHTNESS,
  size: {
    key: 'spine:1', radius: physicalRadius(4.83, SPECTRAL_UNKNOWN), apsis: null, classEvidence: [],
  },
  rv: NO_RV,
  star: makeStar({ proper: 'Fixture', spectral: SPECTRAL_UNKNOWN }),
  facts: { ...FACTS, ...facts },
});

const parked = (placement: ParkedPlacement): RowOutcome => ({ kind: 'parked', placement, brightness: null, rv: NO_RV });

const fold = (outcomes: readonly RowOutcome[]): WalkStats => {
  const stats = walkStatsFold();
  for (const o of outcomes) stats.add(o);
  return stats.result();
};

describe('walkStatsFold', () => {
  it('counts each park under its reason and in no cascade partition', () => {
    const plx = PLACED.parallax;
    const stats = fold([
      parked({ kind: 'parked-parallax', key: 'spine:2', ids: IDS, parallax: { via: 'none', refusals: [] } }),
      parked({ kind: 'parked-no-v', key: 'spine:3', ids: IDS, parallax: plx }),
      parked({ kind: 'parked-no-position', key: 'spine:4', ids: IDS, parallax: plx, direction: { via: 'none', refusals: [] } }),
    ]);
    expect(stats.parkedVia).toEqual({
      refused_no_defensible_parallax: 0, no_parallax_published: 1, no_v_magnitude: 1, no_position: 1,
    });
    expect(stats.parked.map((p) => p.originKey)).toEqual(['spine:2', 'spine:3', 'spine:4']);
    expect(Object.values(stats.distVia).every((n) => n === 0)).toBe(true);
    expect(stats.rvVia.none).toBe(3);
    expect(stats.total).toBe(3);
  });

  it('files an LMC snap and a parallax refusal under the tier the distance stood on before the LMC layer', () => {
    const stats = fold([
      shipped({ bailerJones: { kind: 'override', ref: BJ_REF }, lmc: 'snap' }, { inLmcCone: true }),
      shipped({ lmc: 'parallax_rules_out' }, { inLmcCone: true }),
      shipped({}, { inLmcCone: true }),
    ]);
    expect(stats.lmcCandidates).toBe(3);
    expect(stats.lmcOverridden).toBe(1);
    expect(stats.lmcOverriddenByDistVia.bailer_jones).toBe(1);
    expect(stats.lmcParallaxRefusedByDistVia.gliese_plx).toBe(1);
    expect(stats.distVia).toMatchObject({ lmc_kinematic: 1, gliese_plx: 2, bailer_jones: 0 });
    expect(stats.bjOverridden).toBe(1);
  });

  it('counts a low-precision parallax only where the record ships its inversion', () => {
    const lowSn = glieseParallax(5);
    const stats = fold([
      shipped({ parallax: lowSn }),
      shipped({ parallax: lowSn, bailerJones: { kind: 'override', ref: BJ_REF } }),
      shipped({ parallax: lowSn, lmc: 'snap' }),
      shipped(),
    ]);
    expect(stats.distLowPrecisionParallax).toBe(1);
  });

  it('caps the above-escape sample but counts every fast row, and samples every clamp', () => {
    const stats = fold([
      ...Array.from({ length: VELOCITY_ABOVE_ESCAPE_SAMPLE_CAP + 1 }, () => shipped({}, { fastKmS: 600 })),
      shipped({ velocityClamped: true }, { fastKmS: 2000 }),
    ]);
    expect(stats.velocityAboveEscape).toBe(VELOCITY_ABOVE_ESCAPE_SAMPLE_CAP + 1);
    expect(stats.velocityAboveEscapeSample).toHaveLength(VELOCITY_ABOVE_ESCAPE_SAMPLE_CAP);
    expect(stats.velocityAboveEscapeSample[0]).toBe('Fixture: 600 km/s @ 100 pc');
    expect(stats.velocityClamped).toBe(1);
    expect(stats.velocityClampedSample).toEqual(['Fixture: 2000 km/s @ 100 pc']);
    expect(stats.velocityVia).toMatchObject({ tycho2_pm: VELOCITY_ABOVE_ESCAPE_SAMPLE_CAP + 1, zero: 1 });
  });

  it('splits the Tycho-2 direction tier by its two solution flags', () => {
    const stats = fold([
      shipped({}, { tycho2Direction: { fromIcrs: true, isPhotocentre: false } }),
      shipped({}, { tycho2Direction: { fromIcrs: true, isPhotocentre: true } }),
      shipped(),
    ]);
    expect(stats.directionTycho2FromIcrs).toBe(2);
    expect(stats.directionTycho2Photocentre).toBe(1);
    expect(stats.directionVia.tycho2).toBe(3);
  });
});

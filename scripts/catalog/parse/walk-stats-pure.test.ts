import { describe, expect, it } from 'vitest';

import { sourceRowRef } from '../../util/sources/row-ref-pure';
import { GLIESE } from '../gliese-source';
import { TYCHO2 } from '../tycho2-source';
import { SIMBAD_VALUES } from '../simbad/simbad-values-source';
import type { ParkedPlacement, PlacedPlacement } from '../distance/placement-lineage-pure';
import type { ShippedBrightness } from '../photometry/brightness-colour-lineage-pure';
import { SPECTRAL_UNKNOWN } from '../../../src/catalog-format/spectral/spectral-classify';
import { physicalRadius } from '../../../src/catalog-format/spectral/physical-radius';
import { makeStar } from './star-fixture';
import type { RowOutcome, ShippedFacts } from './stars-parse';
import { GALACTIC_ESCAPE_VELOCITY_KM_S, VELOCITY_SANITY_CEILING_KM_S } from '../distance/velocity';
import {
  VELOCITY_ABOVE_ESCAPE_SAMPLE_CAP, walkStatsFold, walkVelocitySummary, type WalkStats,
} from './walk-stats-pure';

const GL_REF = sourceRowRef(GLIESE, '901');
const TYC_REF = sourceRowRef(TYCHO2, '1-1-1');
const IDS = { tyc: null, hip: null, hd: null, gl: '901', gaiaSourceId: null };

const PLACED: PlacedPlacement = {
  kind: 'placed',
  key: 'spine:1',
  parallax: { via: 'gliese_plx', value: { mas: 10, errMas: 0.01 }, evidence: [GL_REF], refusals: [] },
  direction: {
    via: 'tycho2',
    value: {
      srcRaDeg: 0, srcDecDeg: 0, srcEpoch: 2000, srcPmraMasyr: 1, srcPmdecMasyr: 1, velVia: 'tycho2_pm', tycho2Solution: 'mean',
    },
    evidence: [TYC_REF],
    refusals: [],
  },
  pmRescue: null,
  bailerJones: { kind: 'not-applied' },
  lmc: 'outside_cone',
  rv: { kind: 'kept', rv: { via: 'none', refusals: [] } },
  speed: 'bound',
};
const BRIGHTNESS: ShippedBrightness = {
  kind: 'shipped', key: 'spine:1',
  v: { via: 'tycho2', value: { vMag: 10, outsideRange: false }, evidence: [TYC_REF], refusals: [] },
  spectral: { via: 'none', refusals: [] },
  ci: { via: 'none', refusals: [] },
  dust: null,
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
  star: makeStar({ proper: 'Fixture', spectral: SPECTRAL_UNKNOWN }),
  facts: { distPc: 100, speedKmS: 30, ...facts },
});

const parked = (placement: ParkedPlacement): RowOutcome => ({ kind: 'parked', placement, brightness: null });

const fold = (outcomes: readonly RowOutcome[]): WalkStats => {
  const stats = walkStatsFold();
  for (const o of outcomes) stats.add(o);
  return stats.result();
};

describe('walkStatsFold', () => {
  it('enumerates every park and folds no parked row into the shipped tiers', () => {
    const plx = PLACED.parallax;
    const stats = fold([
      parked({ kind: 'parked-parallax', key: 'spine:2', ids: IDS, parallax: { via: 'none', refusals: [] } }),
      parked({ kind: 'parked-no-v', key: 'spine:3', ids: IDS, parallax: plx }),
      parked({ kind: 'parked-no-position', key: 'spine:4', ids: IDS, parallax: plx, direction: { via: 'none', refusals: [] } }),
    ]);
    expect(stats.parked.map((p) => [p.originKey, p.reason])).toEqual([
      ['spine:2', 'no_parallax_published'], ['spine:3', 'no_v_magnitude'], ['spine:4', 'no_position'],
    ]);
    expect(Object.values(stats.placementDerived).every((n) => n === 0)).toBe(true);
    expect(stats.total).toBe(3);
  });

  it('caps the above-escape sample, and samples every clamp', () => {
    const stats = fold([
      ...Array.from({ length: VELOCITY_ABOVE_ESCAPE_SAMPLE_CAP + 1 }, () => shipped({ speed: 'above_escape' }, { speedKmS: 600 })),
      shipped({ speed: 'clamped' }, { speedKmS: 2000 }),
      shipped(),
    ]);
    expect(stats.velocityAboveEscapeSample).toHaveLength(VELOCITY_ABOVE_ESCAPE_SAMPLE_CAP);
    expect(stats.velocityAboveEscapeSample[0]).toBe('Fixture: 600 km/s @ 100 pc');
    expect(stats.velocityClampedSample).toEqual(['Fixture: 2000 km/s @ 100 pc']);
    expect(stats.placementDerived).toMatchObject({ velocityTycho2Pm: VELOCITY_ABOVE_ESCAPE_SAMPLE_CAP + 2, velocityZero: 1 });
  });
});

describe('walkVelocitySummary', () => {
  it('prints only the above-escape block when nothing was rejected or clamped', () => {
    expect(walkVelocitySummary(fold([shipped()]))).toBe(
      `  velocity above escape (>${GALACTIC_ESCAPE_VELOCITY_KM_S} km/s, kept + tracked) — sample (first 0):`,
    );
  });

  it('prints each sample under its heading, rejections then clamps then above-escape', () => {
    const simbad = sourceRowRef(SIMBAD_VALUES, 9);
    const rejected: PlacedPlacement['rv'] = {
      kind: 'rejected',
      rv: { via: 'simbad', value: { kmS: 1800, bibcode: 'x', ref: simbad }, evidence: [simbad], refusals: [] },
    };
    const stats = fold([
      shipped({ rv: rejected }, { distPc: 12.34 }),
      shipped({ speed: 'clamped' }, { speedKmS: 2000 }),
      shipped({ speed: 'above_escape' }, { speedKmS: 600 }),
    ]);
    expect(walkVelocitySummary(stats).split('\n')).toEqual([
      `  radial term rejected (>${VELOCITY_SANITY_CEILING_KM_S} km/s, proper motion kept):`,
      '    Fixture: 1800.0 km/s @ 12.3 pc',
      `  velocity clamped (>${VELOCITY_SANITY_CEILING_KM_S} km/s, zeroed as artifacts):`,
      '    Fixture: 2000 km/s @ 100 pc',
      `  velocity above escape (>${GALACTIC_ESCAPE_VELOCITY_KM_S} km/s, kept + tracked) — sample (first 1):`,
      '    Fixture: 600 km/s @ 100 pc',
    ]);
  });
});

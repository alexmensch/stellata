import { describe, expect, it } from 'vitest';

import { sourceRowRef } from '../../util/sources/row-ref-pure';
import { GAIA_ASTROMETRY } from '../sources/gaia-astrometry-source';
import { GLIESE } from '../gliese-source';
import { BAILER_JONES } from './refinement/bailer-jones-source';
import { SEEDED_BRANCH, seededCodeCheck } from '../lineage/count-block-fixture';
import { foldStageLines } from '../lineage/lineage-row-pure';
import { PLACEMENT_CODES, placementLineageLines, type PlacedPlacement } from './placement-lineage-pure';
import { placementDerivedFold, placementSummary, type PlacementDerivedCounts } from './placement-counts-pure';

const GAIA = sourceRowRef(GAIA_ASTROMETRY, '1');
const GL = sourceRowRef(GLIESE, '901');
const BJ = sourceRowRef(BAILER_JONES, '1');

const PLACED: PlacedPlacement = {
  kind: 'placed',
  key: 'spine:1',
  parallax: { via: 'gliese_plx', value: { mas: 10, errMas: 0.01 }, evidence: [GL], refusals: [] },
  direction: {
    via: 'gaia_5p',
    value: { srcRaDeg: 0, srcDecDeg: 0, srcEpoch: 2016, srcPmraMasyr: 1, srcPmdecMasyr: 1, velVia: 'gaia_pm' },
    evidence: [GAIA],
    refusals: [],
  },
  pmRescue: null,
  bailerJones: { kind: 'not-applied' },
  lmc: 'outside_cone',
  rv: { kind: 'kept', rv: { via: 'none', refusals: [] } },
  speed: 'bound',
};
const placed = (p: Partial<PlacedPlacement> = {}): PlacedPlacement => ({ ...PLACED, ...p });
const GAIA_PLX: PlacedPlacement['parallax'] = { via: 'gaia_dr3_inversion', value: { mas: 1, errMas: 0.01 }, evidence: [GAIA], refusals: [] };

const derived = (rows: readonly PlacedPlacement[]): PlacementDerivedCounts => {
  const fold = placementDerivedFold();
  for (const p of rows) fold.add(p);
  return fold.result();
};

describe('placementDerivedFold', () => {
  it('files an LMC snap and an own-parallax refusal under the tier the distance stood on before the snap', () => {
    const counts = derived([
      placed({ parallax: GAIA_PLX, bailerJones: { kind: 'override', ref: BJ }, lmc: 'snap' }),
      placed({ lmc: 'parallax_rules_out' }),
      placed({ lmc: 'pm_outside_gate' }),
      placed(),
    ]);
    expect(counts['lmcOverriddenByDistVia.bailer_jones']).toBe(1);
    expect(counts['lmcParallaxRefusedByDistVia.gliese_plx']).toBe(1);
    expect(counts).toMatchObject({ distLmcKinematic: 1, distGliesePlx: 3, distBailerJones: 0 });
  });

  it('counts a low-precision parallax only where the record ships its inversion', () => {
    const lowSn: PlacedPlacement['parallax'] = { ...PLACED.parallax, value: { mas: 10, errMas: 5 } } as PlacedPlacement['parallax'];
    const counts = derived([
      placed({ parallax: lowSn }),
      placed({ parallax: lowSn, lmc: 'snap' }),
      placed(),
    ]);
    expect(counts.distLowPrecisionParallax).toBe(1);
  });

  it('keeps the largest stated Gaia rv error, and none from a rejected term', () => {
    const gaiaRv = (errorKmS: number, kind: 'kept' | 'rejected' = 'kept'): PlacedPlacement => placed({
      rv: { kind, rv: { via: 'gaia_dr3', value: { kmS: 1, errorKmS }, evidence: [GAIA], refusals: [] } },
    });
    expect(derived([gaiaRv(3.5), gaiaRv(39.98), gaiaRv(45, 'rejected')]).rvGaiaErrorMaxKmS).toBe(39.98);
  });

  it('refuses every row shipping a raw Gaia inversion at once, as placement\'s invariant names them', () => {
    const raw = (key: string): PlacedPlacement => placed({ key, parallax: GAIA_PLX, bailerJones: { kind: 'absent' } });
    expect(() => derived([raw('spine:1'), placed(), raw('spine:3')]))
      .toThrow(/2 rows ship a raw Gaia DR3 inversion.*: spine:1, spine:3$/);
  });

  it('pins the block\'s keys', () => {
    expect(Object.keys(derived([])).length).toBe(34);
  });
});

describe('placement count block', () => {
  const lines = [placed(), placed({ lmc: 'snap', speed: 'above_escape' })].flatMap(placementLineageLines);

  it('a new code reaches the snapshot as a key, and fails the check until the snapshot is refreshed', () => {
    const { drift, refreshed } = seededCodeCheck(PLACEMENT_CODES, lines);
    expect(drift.drifted).toBe(true);
    expect(drift.report).toContain(`placement.${SEEDED_BRANCH}`);
    expect(refreshed.drifted).toBe(false);
  });

  it('summarises the cone\'s candidates as the sum of its four LMC codes', () => {
    const summary = placementSummary(foldStageLines(PLACEMENT_CODES, lines), derived([]));
    expect(summary).toContain('LMC kinematic override: 1 / 1 LMC-cone stars (100.0%)');
  });
});

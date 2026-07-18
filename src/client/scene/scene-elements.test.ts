import { describe, expect, it } from 'vitest';
import {
  DETAIL_LEVELS,
  SCENE_ELEMENT_FLOORS,
  SCENE_ELEMENT_IDS,
  type SceneElementId,
  floorPermits,
  elementPermitted,
  visibleSet,
} from './scene-elements';

describe('SCENE_ELEMENT_FLOORS contract', () => {
  it('is exhaustive over SceneElementId — a partial table fails tsc', () => {
    // @ts-expect-error — omitting a scene element must not compile.
    const partial: Record<SceneElementId, { realistic: 'physical'; chart: 'physical' }> = {
      stars: { realistic: 'physical', chart: 'physical' },
    };
    expect(partial).toBeDefined();
    expect(SCENE_ELEMENT_IDS.length).toBe(21);
  });

  it('SCENE_ELEMENT_IDS matches the floor-table keys exactly', () => {
    expect(new Set(SCENE_ELEMENT_IDS)).toEqual(new Set(Object.keys(SCENE_ELEMENT_FLOORS)));
  });
});

describe('floorPermits', () => {
  it('never is never permitted', () => {
    for (const level of DETAIL_LEVELS) expect(floorPermits('never', level)).toBe(false);
  });

  it('is cumulative — a floor is met at its level and every level above', () => {
    expect(floorPermits('physical', 'physical')).toBe(true);
    expect(floorPermits('physical', 'all')).toBe(true);
    expect(floorPermits('representational', 'physical')).toBe(false);
    expect(floorPermits('representational', 'representational')).toBe(true);
    expect(floorPermits('all', 'representational')).toBe(false);
    expect(floorPermits('all', 'all')).toBe(true);
  });
});

describe('visibleSet — cumulative floor derivation', () => {
  it('realistic cumulative sizes are pinned', () => {
    expect(visibleSet('physical', 'realistic').size).toBe(4);
    expect(visibleSet('representational', 'realistic').size).toBe(11);
    expect(visibleSet('all', 'realistic').size).toBe(15);
  });

  it('chart cumulative sizes are pinned', () => {
    // Chart 'physical' carries star + planet names (chartStarNameLabels) —
    // chart mode has no true naked-eye tier, so the base chart is legible.
    expect(visibleSet('physical', 'chart').size).toBe(6);
    expect(visibleSet('representational', 'chart').size).toBe(8);
    expect(visibleSet('all', 'chart').size).toBe(10);
  });

  it('each level is a superset of the level below (cumulativeness)', () => {
    for (const style of ['realistic', 'chart'] as const) {
      const phys = visibleSet('physical', style);
      const repr = visibleSet('representational', style);
      const all = visibleSet('all', style);
      for (const id of phys) expect(repr.has(id)).toBe(true);
      for (const id of repr) expect(all.has(id)).toBe(true);
    }
  });

  it('key elements land in the right tier (realistic)', () => {
    expect(visibleSet('physical', 'realistic').has('milkyWayBand')).toBe(true);
    expect(visibleSet('physical', 'realistic').has('constellationFigures')).toBe(false);
    expect(visibleSet('representational', 'realistic').has('constellationFigures')).toBe(true);
    expect(visibleSet('representational', 'realistic').has('planetLabels')).toBe(false);
    expect(visibleSet('all', 'realistic').has('planetLabels')).toBe(true);
  });

  it('chart floors exclude realistic-only chrome and vice versa', () => {
    expect(elementPermitted('milkyWayBand', 'all', 'chart')).toBe(false);
    expect(elementPermitted('milkyWayIsobar', 'physical', 'chart')).toBe(true);
    expect(elementPermitted('milkyWayIsobar', 'all', 'realistic')).toBe(false);
    expect(elementPermitted('chartBayerGlyphs', 'physical', 'chart')).toBe(true);
    expect(elementPermitted('chartBayerGlyphs', 'all', 'realistic')).toBe(false);
  });
});

// The chart-labels engine (chart-mode/chart-labels.ts) gates each label /
// glyph tier on detailPermits(id) for these elements. Pin the exact chart
// floors so a floor-table reorder that would silently re-tier a glyph
// group fails here rather than in a manual chart-mode smoke.
describe('chart-content gating contract', () => {
  const chartFloor: Record<string, 'physical' | 'representational' | 'all'> = {
    chartBayerGlyphs: 'physical',
    chartVariableRings: 'physical', // gates both variable rings AND binary wings
    chartStarNameLabels: 'physical', // planet name labels ride this tier too
    chartConstellationNames: 'all',
    chartCloudNames: 'all',
  };

  for (const [id, floor] of Object.entries(chartFloor)) {
    it(`${id} is permitted at chart·${floor} and above, not below`, () => {
      const ranks = DETAIL_LEVELS;
      const floorRank = ranks.indexOf(floor);
      for (const level of ranks) {
        expect(elementPermitted(id as SceneElementId, level, 'chart'))
          .toBe(ranks.indexOf(level) >= floorRank);
        // Chart-only content is never part of the realistic style.
        expect(elementPermitted(id as SceneElementId, level, 'realistic')).toBe(false);
      }
    });
  }
});

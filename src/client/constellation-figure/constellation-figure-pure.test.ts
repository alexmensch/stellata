import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import {
  collectFigureSegmentEndpoints,
  figureAimDirection,
  selectFigures,
  type FigureConstellationLike,
  type FigureSelectionInput,
} from './constellation-figure-pure';

describe('collectFigureSegmentEndpoints', () => {
  const cons: FigureConstellationLike[] = [
    { lines: [[0, 1, 2]] },              // 0: one 3-vertex polyline → 2 segments
    { lines: [[10, 11], [20, 21, 22]] }, // 1: two polylines → 1 + 2 segments
    {},                                  // 2: no lines
    { lines: [[7]] },                    // 3: single vertex → no segments
  ];

  it('expands a polyline into consecutive endpoint pairs', () => {
    expect(collectFigureSegmentEndpoints(cons, [0])).toEqual([0, 1, 1, 2]);
  });

  it('walks every polyline of a constellation', () => {
    expect(collectFigureSegmentEndpoints(cons, [1])).toEqual([10, 11, 20, 21, 21, 22]);
  });

  it('concatenates multiple constellations (chart-mode all)', () => {
    expect(collectFigureSegmentEndpoints(cons, [0, 1])).toEqual([
      0, 1, 1, 2, 10, 11, 20, 21, 21, 22,
    ]);
  });

  it('skips a constellation with no asterism lines', () => {
    expect(collectFigureSegmentEndpoints(cons, [2])).toEqual([]);
  });

  it('yields nothing for a single-vertex polyline', () => {
    expect(collectFigureSegmentEndpoints(cons, [3])).toEqual([]);
  });

  it('skips out-of-range indices', () => {
    expect(collectFigureSegmentEndpoints(cons, [99, -1])).toEqual([]);
  });

  it('is empty for an empty index set', () => {
    expect(collectFigureSegmentEndpoints(cons, [])).toEqual([]);
  });

  describe('observe-anchor exclusion', () => {
    it('drops both segments touching the observed star', () => {
      expect(collectFigureSegmentEndpoints(cons, [0], 1)).toEqual([]);
    });

    it('keeps the segments that do not touch it', () => {
      expect(collectFigureSegmentEndpoints(cons, [1], 21)).toEqual([10, 11]);
    });

    it('drops a matching endpoint in either position', () => {
      expect(collectFigureSegmentEndpoints(cons, [1], 10)).toEqual([20, 21, 21, 22]);
      expect(collectFigureSegmentEndpoints(cons, [1], 11)).toEqual([20, 21, 21, 22]);
    });

    it('excludes across every constellation in the set (chart mode)', () => {
      expect(collectFigureSegmentEndpoints(cons, [0, 1], 2)).toEqual([
        0, 1, 10, 11, 20, 21, 21, 22,
      ]);
    });

    it('null — a planet anchor or navigate mode — suppresses nothing', () => {
      expect(collectFigureSegmentEndpoints(cons, [0], null)).toEqual([0, 1, 1, 2]);
      expect(collectFigureSegmentEndpoints(cons, [0])).toEqual([0, 1, 1, 2]);
    });

    it('does not treat star index 0 as "no exclusion"', () => {
      expect(collectFigureSegmentEndpoints(cons, [0], 0)).toEqual([1, 2]);
    });
  });
});

describe('selectFigures', () => {
  const base: FigureSelectionInput = {
    chart: false,
    highlightCon: -1,
    constellationCount: 88,
    inObserve: false,
    observeAnchorStar: null,
  };
  const sel = (patch: Partial<FigureSelectionInput> = {}) =>
    selectFigures({ ...base, ...patch });

  it('draws nothing with no highlight outside chart mode', () => {
    expect(sel().conIndices).toEqual([]);
  });

  it('draws the highlighted figure alone', () => {
    expect(sel({ highlightCon: 82 }).conIndices).toEqual([82]);
  });

  it('draws all 88 in chart mode, which is observe-only', () => {
    expect(sel({ chart: true, inObserve: true }).conIndices).toHaveLength(88);
    expect(sel({ chart: true, inObserve: false, highlightCon: 82 }).conIndices)
      .toEqual([82]);
  });

  it('drops the segments of the star OBSERVE stands on', () => {
    expect(sel({ observeAnchorStar: 142352 }).excludeStarIdx).toBe(142352);
    expect(sel().excludeStarIdx).toBeNull();
  });

  it('does not treat star index 0 as "no anchor"', () => {
    expect(sel({ observeAnchorStar: 0 }).excludeStarIdx).toBe(0);
    expect(sel({ observeAnchorStar: 0 }).signature).not.toBe(sel().signature);
  });

  it('keys the signature on every input the geometry reads', () => {
    expect(sel({ highlightCon: 3 }).signature).toBe(sel({ highlightCon: 3 }).signature);
    expect(sel({ highlightCon: 3 }).signature).not.toBe(sel({ highlightCon: 4 }).signature);
    expect(sel({ chart: true, inObserve: true }).signature)
      .not.toBe(sel({ inObserve: true }).signature);
    expect(sel({ observeAnchorStar: 7 }).signature)
      .not.toBe(sel({ observeAnchorStar: 8 }).signature);
  });
});

describe('figureAimDirection', () => {
  const at = (positions: Record<number, [number, number, number]>, from = new THREE.Vector3()) => ({
    localPositionInto: (idx: number, out: THREE.Vector3) => out.set(...positions[idx]),
    from,
    excludeStarIdx: null,
  });
  const expectDir = (got: THREE.Vector3 | null, x: number, y: number, z: number) => {
    const want = new THREE.Vector3(x, y, z).normalize();
    expect(got).not.toBeNull();
    expect(got!.x).toBeCloseTo(want.x, 12);
    expect(got!.y).toBeCloseTo(want.y, 12);
    expect(got!.z).toBeCloseTo(want.z, 12);
  };

  it('is null for a figure with no vertex', () => {
    const inputs = at({});
    expect(figureAimDirection(undefined, inputs)).toBeNull();
    expect(figureAimDirection([], inputs)).toBeNull();
    expect(figureAimDirection([[]], inputs)).toBeNull();
  });

  it('weights each member once, however far away it is', () => {
    // A 3D mean of these positions points almost straight up y; the figure as
    // drawn is centred halfway between the two directions.
    expectDir(figureAimDirection([[0, 1]], at({ 0: [1, 0, 0], 1: [0, 100, 0] })), 1, 1, 0);
  });

  it('counts a vertex shared by two polylines once', () => {
    const positions: Record<number, [number, number, number]> = { 0: [1, 0, 0], 1: [0, 1, 0], 2: [0, 0, 1] };
    expectDir(figureAimDirection([[0, 1], [1, 2]], at(positions)), 1, 1, 1);
  });

  it('judges direction from the vantage', () => {
    const positions: Record<number, [number, number, number]> = { 0: [10, 0, 0], 1: [-10, 0, 0] };
    expectDir(figureAimDirection([[0, 1]], at(positions, new THREE.Vector3(0, -10, 0))), 0, 1, 0);
  });

  it('is null when the members surround the vantage symmetrically', () => {
    expect(figureAimDirection([[0, 1]], at({ 0: [10, 0, 0], 1: [-10, 0, 0] }))).toBeNull();
  });

  it('skips the observe anchor wherever it sits', () => {
    // Observing from star 0, which drifted off the exact vantage.
    const positions: Record<number, [number, number, number]> = { 0: [0, -1e-6, 0], 1: [0, 0, 5] };
    expectDir(figureAimDirection([[0, 1]], { ...at(positions), excludeStarIdx: 0 }), 0, 0, 1);
    expect(figureAimDirection([[0, 0]], { ...at(positions), excludeStarIdx: 0 })).toBeNull();
  });

  it('skips a member at the vantage, which has no direction from there', () => {
    const positions: Record<number, [number, number, number]> = { 0: [0, 0, 0], 1: [0, 0, 5] };
    expectDir(figureAimDirection([[0, 1]], at(positions)), 0, 0, 1);
    expect(figureAimDirection([[0, 0]], at(positions))).toBeNull();
  });
});

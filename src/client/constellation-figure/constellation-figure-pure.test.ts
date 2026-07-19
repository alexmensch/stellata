import { describe, it, expect } from 'vitest';
import {
  collectFigureSegmentEndpoints,
  type FigureConstellationLike,
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
});

// Stick-figure polylines → flat LineSegments endpoint list (two star indices
// per segment), and the active-set selection driving the rebuild.
// See README.md.

export interface FigureConstellationLike {
  lines?: number[][];
}

export interface FigureSelectionInput {
  /** Chart mode draws all 88, and is an OBSERVE-only overlay. */
  readonly chart: boolean;
  /** Negative for none. */
  readonly highlightCon: number;
  readonly constellationCount: number;
  readonly inObserve: boolean;
  /** `ObserveTransition.observeAnchorOf('star')`. */
  readonly observeAnchorStar: number | null;
}

export interface FigureSelection {
  readonly conIndices: number[];
  readonly excludeStarIdx: number | null;
  /** Rebuild key over every input the geometry depends on. */
  readonly signature: string;
}

export function selectFigures(input: FigureSelectionInput): FigureSelection {
  const chartActive = input.chart && input.inObserve;
  const excludeStarIdx = input.observeAnchorStar;
  const conIndices = chartActive
    ? Array.from({ length: input.constellationCount }, (_, i) => i)
    : input.highlightCon >= 0 ? [input.highlightCon] : [];
  return {
    conIndices,
    excludeStarIdx,
    signature: `${chartActive ? 1 : 0}|${input.highlightCon}|${excludeStarIdx ?? -1}`,
  };
}

export function collectFigureSegmentEndpoints(
  constellations: readonly FigureConstellationLike[],
  conIndices: readonly number[],
  excludeStarIdx: number | null = null,
): number[] {
  const endpoints: number[] = [];
  for (const ci of conIndices) {
    if (ci < 0 || ci >= constellations.length) continue;
    const lines = constellations[ci].lines;
    if (!lines) continue;
    for (const polyline of lines) {
      for (let j = 0; j < polyline.length - 1; j++) {
        const a = polyline[j];
        const b = polyline[j + 1];
        if (a === excludeStarIdx || b === excludeStarIdx) continue;
        endpoints.push(a, b);
      }
    }
  }
  return endpoints;
}

// Stick-figure polylines → flat LineSegments endpoint list (two star indices
// per segment). See README.md.

export interface FigureConstellationLike {
  lines?: number[][];
}

export function collectFigureSegmentEndpoints(
  constellations: readonly FigureConstellationLike[],
  conIndices: readonly number[],
): number[] {
  const endpoints: number[] = [];
  for (const ci of conIndices) {
    if (ci < 0 || ci >= constellations.length) continue;
    const lines = constellations[ci].lines;
    if (!lines) continue;
    for (const polyline of lines) {
      for (let j = 0; j < polyline.length - 1; j++) {
        endpoints.push(polyline[j], polyline[j + 1]);
      }
    }
  }
  return endpoints;
}

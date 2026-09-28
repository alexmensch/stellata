// Stick-figure polylines → flat LineSegments endpoint list (two star indices
// per segment), the active-set selection driving the rebuild, and the aim
// direction. See README.md.

import * as THREE from 'three';
import { AIM_DEGENERATE_DIST_PC } from '../camera/controls/aim-controller';

export interface FigureAimInputs {
  readonly localPositionInto: (idx: number, out: THREE.Vector3) => THREE.Vector3;
  /** The vantage the figure is seen from. */
  readonly from: Readonly<THREE.Vector3>;
  /** The observe anchor: the vantage's own star, which has no direction. */
  readonly excludeStarIdx: number | null;
}

/** README.md#the-aim-direction: the mean unit direction from the vantage to each
 *  distinct vertex. Null when no vertex has a direction from there. */
export function figureAimDirection(
  lines: readonly (readonly number[])[] | undefined,
  inputs: FigureAimInputs,
): THREE.Vector3 | null {
  const members = new Set(lines?.flat());
  const p = new THREE.Vector3();
  const sum = new THREE.Vector3();
  for (const idx of members) {
    if (idx === inputs.excludeStarIdx) continue;
    inputs.localPositionInto(idx, p).sub(inputs.from);
    const dist = p.length();
    if (dist >= AIM_DEGENERATE_DIST_PC) sum.addScaledVector(p, 1 / dist);
  }
  const len = sum.length();
  return len >= AIM_DEGENERATE_DIST_PC ? sum.divideScalar(len) : null;
}

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

// Stick-figure polylines → flat LineSegments endpoint list (two star indices
// per segment), the active-set selection driving the rebuild, and the aim
// point. See README.md.

import * as THREE from 'three';
import { DCAM_LOG_FLOOR_PC } from '../camera/timing';
import { apparentMagnitude } from '../solar-system/perceptual-magnitude';

/** How many of a figure's members, brightest from the vantage first, the aim
 *  point averages. */
export const AIM_BRIGHTEST_COUNT = 8;

export interface FigureAimInputs {
  readonly localPositionInto: (idx: number, out: THREE.Vector3) => THREE.Vector3;
  readonly absmag: ArrayLike<number>;
  /** The vantage brightness is judged from — the orbit target. */
  readonly from: Readonly<THREE.Vector3>;
}

/** README.md#the-aim-point. Null when the figure has no vertex. */
export function figureAimPoint(
  lines: readonly (readonly number[])[] | undefined,
  inputs: FigureAimInputs,
): THREE.Vector3 | null {
  const members = new Set(lines?.flat());
  if (members.size === 0) return null;
  const p = new THREE.Vector3();
  const scored = [...members].map((idx) => {
    const dist = Math.max(inputs.localPositionInto(idx, p).distanceTo(inputs.from), DCAM_LOG_FLOOR_PC);
    return { idx, appMag: apparentMagnitude(inputs.absmag[idx], dist) };
  });
  scored.sort((a, b) => a.appMag - b.appMag);
  const brightest = scored.slice(0, AIM_BRIGHTEST_COUNT);
  const centroid = new THREE.Vector3();
  for (const { idx } of brightest) centroid.add(inputs.localPositionInto(idx, p));
  return centroid.divideScalar(brightest.length);
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

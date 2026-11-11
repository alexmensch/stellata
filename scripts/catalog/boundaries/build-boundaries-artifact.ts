// Renders public/constellation-boundaries.json for the chart-mode boundary
// layer. See README.md.

import type {
  IauConstellationLookup,
} from '../../../src/astro-core/iau-geometry/iau-boundaries-pure';
import { raDecFromUnitVector } from '../../../src/astro-core/equatorial-basis';
import { apparentMagnitude } from '../../../src/astro-core/perceptual-magnitude';
import {
  buildBoundaryArtifact,
  countDirections,
  misplacementOffsetPc,
  type BoundaryArtifact,
  type FadeSample,
} from '../../../src/catalog-format/boundaries/boundaries-artifact-pure';

/** The per-record inputs the fade table needs: where the star is and how
 *  bright it looks from Sol. */
export interface BoundaryFadeStar {
  x: number;
  y: number;
  z: number;
  absmag: number;
}

/** The boundaries stage's count block. */
export type BoundariesCounts = {
  /** Boundary arcs in public/constellation-boundaries.json — one per IAU
   *  edge record, so a drift means the edge set changed. */
  boundarySegments: number;
  /** Precessed ICRS sample directions across all boundary arcs. Set by the
   *  subdivision step, and the artifact's whole wire cost. */
  boundaryDirections: number;
  /** RA runs the resolved cell grid collapses to, band-major. The wire cost
   *  of the runtime membership lookup, and the one dimension of that grid no
   *  other pin covers — the 89 regions and their areas are pinned in
   *  src/client/constellation-boundaries/. */
  boundaryRegionRuns: number;
  /** public/constellation-boundaries.json size, rounded to KiB. Pinned
   *  because the direction quantisation is a wire-size choice with no other
   *  visible signal — dropping `DIRECTION_DECIMALS` by one moves ~30k values
   *  a character each, ~30 KiB. Rounded rather than exact: the file is 30k
   *  decimal-formatted floats, so a last-bit difference in one trig call
   *  (V8 differs across Node versions and architectures — CI is Node 24
   *  x64) changes its byte length while changing nothing that matters. */
  boundaryArtifactKb: number;
};

export interface BoundaryArtifactReport {
  json: string;
  bytes: number;
  counts: BoundariesCounts;
  artifact: BoundaryArtifact;
}

/** Sol is at the origin: no direction to measure a wall against, and an
 *  apparent magnitude that has nothing to do with the slider's population. */
export function collectFadeSamples(
  stars: readonly BoundaryFadeStar[],
  distanceToNearestEdgeDeg: (j2000: { raDeg: number; decDeg: number }) => number,
): FadeSample[] {
  const samples: FadeSample[] = [];
  for (const s of stars) {
    const distPc = Math.hypot(s.x, s.y, s.z);
    if (distPc === 0) continue;
    const nearestDeg = distanceToNearestEdgeDeg(raDecFromUnitVector({
      x: s.x / distPc, y: s.y / distPc, z: s.z / distPc,
    }));
    samples.push({
      offsetPc: misplacementOffsetPc(nearestDeg, distPc),
      appMag: apparentMagnitude(s.absmag, distPc),
    });
  }
  return samples;
}

export function renderBoundaryArtifact(
  stars: readonly BoundaryFadeStar[],
  lookup: IauConstellationLookup,
): BoundaryArtifactReport {
  const samples = collectFadeSamples(stars, lookup.distanceToNearestEdgeDeg);
  const artifact = buildBoundaryArtifact(lookup, samples);
  const json = JSON.stringify(artifact) + '\n';
  const bytes = Buffer.byteLength(json);
  return {
    json,
    bytes,
    counts: {
      boundarySegments: artifact.segments.length,
      boundaryDirections: countDirections(artifact.segments),
      boundaryRegionRuns: artifact.regions.runs.length / 2,
      boundaryArtifactKb: Math.round(bytes / 1024),
    },
    artifact,
  };
}

/** The build log's line for the artifact, after its file name. */
export function boundaryArtifactSummary({ bytes, counts, artifact }: BoundaryArtifactReport): string {
  const { fade } = artifact;
  const last = fade.magLimits.length - 1;
  return `(${counts.boundarySegments} arcs, ${counts.boundaryDirections} directions, `
    + `${artifact.labels.length} labels, ${counts.boundaryRegionRuns} region runs, `
    + `${(bytes / 1024).toFixed(1)} KB); fade window at V<=${fade.magLimits[last]}: `
    + fade.quantilePcts.map((pct, j) => `${pct}%=${fade.offsetsPc[last][j].toFixed(2)} pc`).join(', ');
}

// Writes public/constellation-boundaries.json for the chart-mode boundary
// layer. See README.md.

import { writeFile } from 'node:fs/promises';

import type {
  IauConstellationLookup,
} from '../../../src/client/constellation-boundaries/iau-boundaries-pure';
import { raDecFromUnitVector } from '../../../src/client/util/equatorial-basis';
import { absoluteToApparentMagnitude } from '../catalog-pure';
import {
  buildBoundaryArtifact,
  countDirections,
  misplacementOffsetPc,
  type BoundaryArtifact,
  type FadeSample,
} from './boundaries-artifact-pure';

/** The per-record inputs the fade table needs: where the star is and how
 *  bright it looks from Sol. */
export interface BoundaryFadeStar {
  x: number;
  y: number;
  z: number;
  absmag: number;
}

export interface BoundaryArtifactReport {
  segments: number;
  directions: number;
  bytes: number;
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
      appMag: absoluteToApparentMagnitude(s.absmag, distPc),
    });
  }
  return samples;
}

export async function writeBoundaryArtifact(
  outPath: string,
  stars: readonly BoundaryFadeStar[],
  lookup: IauConstellationLookup,
): Promise<BoundaryArtifactReport> {
  const samples = collectFadeSamples(stars, lookup.distanceToNearestEdgeDeg);
  const artifact = buildBoundaryArtifact(lookup.edges, samples);
  const json = JSON.stringify(artifact) + '\n';
  await writeFile(outPath, json);
  return {
    segments: artifact.segments.length,
    directions: countDirections(artifact.segments),
    bytes: Buffer.byteLength(json),
    artifact,
  };
}

// Blend split: records sharing one backing Gaia source divide its combined light equally. See README.md#blend-split.

import { physicalRadius, type RadiusResolution } from '../../../../src/catalog-format/spectral/physical-radius';
import type { SpectralInfo } from '../../../../src/catalog-format/spectral/spectral-classify';
import type { NamedStar } from '../../parse/stars-parse';

export interface BlendSplitCandidate {
  star: NamedStar;
  spectral: SpectralInfo;
}

export interface BlendSplit<C extends BlendSplitCandidate> {
  cand: C;
  /** Records sharing the backing source. */
  n: number;
  radius: RadiusResolution;
}

/** Dims and re-sizes, in place, every record of a source backing two or more. */
export function splitBlends<C extends BlendSplitCandidate>(
  bySource: Iterable<readonly C[]>,
): BlendSplit<C>[] {
  const splits: BlendSplit<C>[] = [];
  for (const bucket of bySource) {
    if (bucket.length < 2) continue;
    const splitMag = 2.5 * Math.log10(bucket.length);
    for (const cand of bucket) {
      cand.star.absmag += splitMag;
      const radius = physicalRadius(cand.star.absmag, cand.spectral);
      cand.star.physicalRadius = radius.rSun;
      splits.push({ cand, n: bucket.length, radius });
    }
  }
  return splits;
}

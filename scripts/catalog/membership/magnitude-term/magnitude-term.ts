// Streaming reads over the Gaia magnitude pull. See README.md.

import { streamArtifact } from '../../../util/sources/source';
import {
  gaiaAstrometryAccumulator,
  type GaiaAstrometryCatalogRow,
} from '../../distance/direction-cascade';
import { MEMBERSHIP_MANIFEST } from '../membership-manifest-tsv';
import { MAGNITUDE_PULL } from './magnitude-pull-source';
import {
  magnitudeTermSourceId,
  magnitudeTermAccumulator,
  type MagnitudeTermSelection,
} from './magnitude-term-pure';

export async function readMagnitudeTerm(floorV: number): Promise<MagnitudeTermSelection> {
  const acc = magnitudeTermAccumulator(floorV, MAGNITUDE_PULL);
  await MAGNITUDE_PULL.read(acc.line);
  return acc.result();
}

/** The term's own manifest rows, streamed: the record build needs this keep-set
 *  before it walks the manifest, and the file runs to tens of megabytes. */
export async function readMagnitudeTermSourceIds(): Promise<Set<string>> {
  const out = new Set<string>();
  await streamArtifact(MEMBERSHIP_MANIFEST, (row) => {
    const sourceId = magnitudeTermSourceId(row);
    if (sourceId !== null) out.add(sourceId);
  });
  return out;
}

/** The pull's 5p astrometry for `keep` — README.md#the-astrometry-comes-with-it.
 * */
export async function readMagnitudeTermAstrometry(
  keep: ReadonlySet<string>,
): Promise<Map<string, GaiaAstrometryCatalogRow>> {
  if (keep.size === 0) return new Map();
  const acc = gaiaAstrometryAccumulator(MAGNITUDE_PULL, keep);
  await MAGNITUDE_PULL.read(acc.line);
  return acc.result();
}

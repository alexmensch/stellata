// The record build's streaming reads over the Gaia magnitude pull and the term's manifest rows. See README.md.

import { streamArtifact } from '../../../util/sources/source';
import {
  gaiaAstrometryAccumulator,
  type GaiaAstrometryRow,
} from '../../sources/gaia-astrometry-source';
import { MEMBERSHIP_MANIFEST } from '../membership-manifest-tsv';
import { MAGNITUDE_PULL } from './magnitude-pull-source';
import { magnitudeTermSourceId } from './magnitude-term-pure';

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
): Promise<Map<string, GaiaAstrometryRow>> {
  if (keep.size === 0) return new Map();
  const acc = gaiaAstrometryAccumulator(MAGNITUDE_PULL, keep);
  await MAGNITUDE_PULL.read(acc.line);
  return acc.result();
}

/** The term's sources' pull rows into `gaia`, where the catalogue file holds
 *  none: README.md#the-astrometry-comes-with-it. */
export async function addMagnitudeTermAstrometry(
  gaia: Map<string, GaiaAstrometryRow>,
): Promise<{ added: number; requested: number }> {
  const keep = await readMagnitudeTermSourceIds();
  let added = 0;
  for (const [sourceId, row] of await readMagnitudeTermAstrometry(keep)) {
    if (gaia.has(sourceId)) continue;
    gaia.set(sourceId, row);
    added++;
  }
  return { added, requested: keep.size };
}

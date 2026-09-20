// Streaming reads over the Gaia magnitude pull. See README.md.

import { resolve } from 'node:path';

import { REPO_ROOT as ROOT } from '../../../util/paths';
import {
  gaiaAstrometryAccumulator,
  type GaiaAstrometryCatalogRow,
} from '../../distance/direction-cascade';
import { forEachLine } from '../../parse/tsv-stream';
import { manifestLineReader } from '../membership-manifest-pure';
import {
  MAGNITUDE_PULL_FILE,
  MAGNITUDE_PULL_HINT,
  isMagnitudeTermRow,
  magnitudeTermAccumulator,
  type MagnitudeTermSelection,
} from './magnitude-term-pure';

export const MAGNITUDE_PULL_TSV = resolve(ROOT, MAGNITUDE_PULL_FILE);

export async function readMagnitudeTerm(floorV: number): Promise<MagnitudeTermSelection> {
  const acc = magnitudeTermAccumulator(floorV);
  await forEachLine(MAGNITUDE_PULL_TSV, acc.line);
  return acc.result();
}

/** The term's own manifest rows, streamed: the record build needs this keep-set
 *  before it walks the manifest, and the file runs to tens of megabytes. */
export async function readMagnitudeTermSourceIds(manifestPath: string): Promise<Set<string>> {
  const out = new Set<string>();
  await forEachLine(manifestPath, manifestLineReader((row) => {
    if (isMagnitudeTermRow(row)) out.add(row.gaia_source_id);
  }));
  return out;
}

/** The pull's 5p astrometry for `keep` — README.md § The astrometry comes
 *  with it. */
export async function readMagnitudeTermAstrometry(
  keep: ReadonlySet<string>,
): Promise<Map<string, GaiaAstrometryCatalogRow>> {
  if (keep.size === 0) return new Map();
  const acc = gaiaAstrometryAccumulator(MAGNITUDE_PULL_FILE, MAGNITUDE_PULL_HINT, keep);
  await forEachLine(MAGNITUDE_PULL_TSV, acc.line);
  return acc.result();
}

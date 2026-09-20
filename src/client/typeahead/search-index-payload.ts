// What the search-index worker computes and hands back, and the one
// function that computes it. See ./README.md § The search-index worker.

import type { SearchEntry } from '../../../scripts/catalog/record/catalog-pure';
import { buildSearchIndex, type SearchIndex } from './search-corpus';
import { buildBayerMap, buildSpectralMap, type BayerInfo } from './star-name-tables';
import { displayNamesFromSearchIndex } from '../../../scripts/catalog/naming/star-naming-pure';

export interface ConstellationName {
  code: string;
  name: string;
}

export interface SearchIndexPayload {
  /** The composed-designation tier of the label ladder. The name tier is
   *  the binary's and the main thread already holds it — these fill the
   *  records an authority never named. */
  composedLabels: Map<number, string>;
  spectral: Map<number, string>;
  bayer: Map<number, BayerInfo>;
  corpus: SearchIndex;
}

/**
 * Every catalogue-wide derivation of the search index, in one pass of the
 * display-name composer.
 *
 * The composer is the expensive part — 329 ms over 385k entries — and it
 * was running TWICE, once for the label table and again inside the corpus
 * build. Both callers take the one result here.
 */
export function buildSearchIndexPayload(
  raw: SearchEntry[],
  constellations: ConstellationName[],
): SearchIndexPayload {
  const composed = displayNamesFromSearchIndex(raw, constellations);
  const composedLabels = new Map<number, string>();
  for (const [idx, c] of composed) composedLabels.set(idx, c.label);
  return {
    composedLabels,
    spectral: buildSpectralMap(raw),
    bayer: buildBayerMap(raw),
    corpus: buildSearchIndex(raw, constellations, composed),
  };
}

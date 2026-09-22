// What the search-index worker computes and hands back, and the one
// function that computes it. See ./README.md § The search-index worker.

import type { SearchEntry } from '../../../scripts/catalog/record/catalog-pure';
import { buildSearchIndex, type SearchIndex } from './search-corpus';
import {
  buildBayerMap, buildSpectralMap, composedLabelsOf, type BayerInfo,
} from './star-name-tables';
import { displayNamesFromSearchIndex } from '../../../scripts/catalog/naming/star-naming-pure';

export interface ConstellationName {
  code: string;
  name: string;
}

export interface SearchIndexPayload {
  composedLabels: Map<number, string>;
  spectral: Map<number, string>;
  bayer: Map<number, BayerInfo>;
  corpus: SearchIndex;
}

/** See ./README.md § The search-index worker. */
export function buildSearchIndexPayload(
  raw: SearchEntry[],
  constellations: ConstellationName[],
): SearchIndexPayload {
  const composed = displayNamesFromSearchIndex(raw, constellations);
  return {
    composedLabels: composedLabelsOf(composed),
    spectral: buildSpectralMap(raw),
    bayer: buildBayerMap(raw),
    corpus: buildSearchIndex(raw, constellations, composed),
  };
}

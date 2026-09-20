// Spawns the search-index worker and falls back to computing inline.
// See ./README.md § The search-index worker.

import type { SearchEntry } from '../../../scripts/catalog/record/catalog-pure';
import {
  buildSearchIndexPayload,
  type ConstellationName,
  type SearchIndexPayload,
} from './search-index-payload';
import type {
  SearchIndexWorkerRequest,
  SearchIndexWorkerResponse,
} from './search-index-worker';

/** The inline path, for a runtime with no `Worker` and for the rejection
 *  case. Identical output, on the main thread, at the cost the worker
 *  exists to move. */
async function computeInline(
  searchIndexUrl: string,
  constellationsUrl: string,
): Promise<SearchIndexPayload> {
  const [raw, constellations] = await Promise.all([
    fetch(searchIndexUrl).then((r) => r.json() as Promise<SearchEntry[]>),
    fetch(constellationsUrl).then((r) => r.json() as Promise<ConstellationName[]>),
  ]);
  return buildSearchIndexPayload(raw, constellations);
}

/**
 * Derive the search index's catalogue-wide tables off the main thread.
 *
 * Everything crossing back is structured-cloneable by construction — plain
 * Maps and arrays, no class instances — which is why the corpus is data the
 * caller hands to Fuse rather than a built Fuse index: constructing Fuse
 * over the returned entries costs 13 ms, so serialising one would buy
 * nothing and pin the search options to this module.
 *
 * Never rejects. A worker that fails to start, throws, or is absent falls
 * back to the inline path, because search arriving late is a degradation
 * and search never arriving is a broken app.
 */
export function loadSearchIndexPayload(
  baseUrl: string,
): Promise<SearchIndexPayload> {
  const searchIndexUrl = `${baseUrl}search-index.json`;
  const constellationsUrl = `${baseUrl}constellations.json`;
  if (typeof Worker === 'undefined') {
    return computeInline(searchIndexUrl, constellationsUrl);
  }
  return new Promise<SearchIndexPayload>((resolve) => {
    let worker: Worker;
    const inline = (why: string) => {
      console.warn(`search-index worker unavailable (${why}); deriving inline`);
      resolve(computeInline(searchIndexUrl, constellationsUrl));
    };
    try {
      worker = new Worker(new URL('./search-index-worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch (err) {
      inline(err instanceof Error ? err.message : String(err));
      return;
    }
    worker.onmessage = (event: MessageEvent<SearchIndexWorkerResponse>) => {
      const data = event.data;
      worker.terminate();
      if (data.ok) resolve(data.payload);
      else inline(data.message);
    };
    worker.onerror = (event) => {
      worker.terminate();
      inline(event.message || 'worker error');
    };
    const request: SearchIndexWorkerRequest = { searchIndexUrl, constellationsUrl };
    worker.postMessage(request);
  });
}

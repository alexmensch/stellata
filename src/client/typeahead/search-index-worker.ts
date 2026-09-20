// Worker entry: fetch the search index, derive every catalogue-wide table
// from it, post them back. See ./README.md § The search-index worker.

import type { SearchEntry } from '../../../scripts/catalog/record/catalog-pure';
import {
  buildSearchIndexPayload,
  type ConstellationName,
  type SearchIndexPayload,
} from './search-index-payload';

export interface SearchIndexWorkerRequest {
  searchIndexUrl: string;
  constellationsUrl: string;
}

export type SearchIndexWorkerResponse =
  | { ok: true; payload: SearchIndexPayload }
  | { ok: false; message: string };

self.onmessage = async (event: MessageEvent<SearchIndexWorkerRequest>) => {
  const { searchIndexUrl, constellationsUrl } = event.data;
  try {
    // Both are already in the HTTP cache — the main thread fetches the same
    // index for its own per-star lookups — so this costs no network.
    const [raw, constellations] = await Promise.all([
      fetch(searchIndexUrl).then((r) => r.json() as Promise<SearchEntry[]>),
      fetch(constellationsUrl).then((r) => r.json() as Promise<ConstellationName[]>),
    ]);
    const payload = buildSearchIndexPayload(raw, constellations);
    const response: SearchIndexWorkerResponse = { ok: true, payload };
    self.postMessage(response);
  } catch (err) {
    const response: SearchIndexWorkerResponse = {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};

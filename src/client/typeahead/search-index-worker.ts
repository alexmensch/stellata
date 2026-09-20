// See ./README.md § The search-index worker.

import type { SearchEntry } from '../../../scripts/catalog/record/catalog-pure';
import {
  buildSearchIndexPayload,
  type ConstellationName,
  type SearchIndexPayload,
} from './search-index-payload';

export interface SearchIndexWorkerRequest {
  bytes: ArrayBuffer;
  constellations: ConstellationName[];
}

export type SearchIndexWorkerResponse =
  | { ok: true; payload: SearchIndexPayload }
  | { ok: false; message: string };

self.onmessage = (event: MessageEvent<SearchIndexWorkerRequest>) => {
  const { bytes, constellations } = event.data;
  let response: SearchIndexWorkerResponse;
  try {
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as SearchEntry[];
    response = { ok: true, payload: buildSearchIndexPayload(raw, constellations) };
  } catch (err) {
    response = { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(response);
};

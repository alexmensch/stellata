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

export interface SearchIndexLoad {
  raw: SearchEntry[];
  tables: SearchIndexPayload;
}

function deriveOffThread(
  bytes: ArrayBuffer,
  constellations: ConstellationName[],
): Promise<SearchIndexPayload | null> {
  if (typeof Worker === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let worker: Worker;
    const giveUp = (why: string) => {
      console.warn(`search-index worker unavailable (${why}); deriving inline`);
      resolve(null);
    };
    try {
      worker = new Worker(new URL('./search-index-worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch (err) {
      giveUp(err instanceof Error ? err.message : String(err));
      return;
    }
    worker.onmessage = (event: MessageEvent<SearchIndexWorkerResponse>) => {
      worker.terminate();
      const data = event.data;
      if (data.ok) resolve(data.payload);
      else giveUp(data.message);
    };
    worker.onerror = (event) => {
      worker.terminate();
      giveUp(event.message || 'worker error');
    };
    const request: SearchIndexWorkerRequest = { bytes, constellations };
    worker.postMessage(request);
  });
}

export async function loadSearchIndex(
  bytes: ArrayBuffer,
  constellations: readonly ConstellationName[],
): Promise<SearchIndexLoad> {
  const names = constellations.map((c) => ({ code: c.code, name: c.name }));
  const offThread = deriveOffThread(bytes, names);
  const raw = JSON.parse(new TextDecoder().decode(bytes)) as SearchEntry[];
  return { raw, tables: (await offThread) ?? buildSearchIndexPayload(raw, names) };
}

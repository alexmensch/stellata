// See ./README.md#the-catalog-decode-worker.

import type { RecordSpan } from '../../../scripts/catalog/record/catalog-pure';
import {
  decodeCatalogWindow,
  recordWindowBytes,
  type CatalogWindow,
} from './catalog-window';
import type { CatalogDecodeRequest, CatalogDecodeResponse } from './catalog-decode-worker';

export interface CatalogDecoder {
  /** Never rejects — ./README.md#the-catalog-decode-worker. */
  decode(source: ArrayBuffer, span: RecordSpan): Promise<CatalogWindow>;
  dispose(): void;
}

export function decodeInline(source: ArrayBuffer, span: RecordSpan): CatalogWindow {
  const { start, length } = recordWindowBytes(span.offset, span.first, span.end);
  return decodeCatalogWindow(new DataView(source, start, length), span.first, span.end - span.first);
}

/** See ./README.md#the-catalog-decode-worker silence as a failure mode. */
const WORKER_REPLY_TIMEOUT_MS = 10_000;

export function createCatalogDecoder(): CatalogDecoder {
  let worker: Worker | null = null;
  let retired = typeof Worker === 'undefined';
  let nextId = 0;
  const pending = new Map<number, (r: CatalogDecodeResponse | null) => void>();

  /** See ./README.md#the-catalog-decode-worker terminating and settling. */
  const stop = (): void => {
    retired = true;
    worker?.terminate();
    worker = null;
    for (const settle of pending.values()) settle(null);
    pending.clear();
  };

  const retire = (why: string): void => {
    console.warn(`catalog-decode worker unavailable (${why}); decoding inline`);
    stop();
  };

  const spawn = (): Worker | null => {
    if (worker || retired) return worker;
    try {
      worker = new Worker(new URL('./catalog-decode-worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch (err) {
      retire(err instanceof Error ? err.message : String(err));
      return null;
    }
    worker.onmessage = (event: MessageEvent<CatalogDecodeResponse>) => {
      pending.get(event.data.id)?.(event.data);
      pending.delete(event.data.id);
    };
    worker.onerror = (event) => retire(event.message || 'worker error');
    return worker;
  };

  return {
    async decode(source, span) {
      const live = spawn();
      if (!live) return decodeInline(source, span);
      const id = nextId++;
      const answer = await new Promise<CatalogDecodeResponse | null>((resolve) => {
        const timer = setTimeout(
          () => retire(`no reply in ${WORKER_REPLY_TIMEOUT_MS} ms`),
          WORKER_REPLY_TIMEOUT_MS,
        );
        pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
        try {
          const { start, length } = recordWindowBytes(span.offset, span.first, span.end);
          const request: CatalogDecodeRequest = {
            id,
            first: span.first,
            count: span.end - span.first,
            // A copy — ./README.md#the-catalog-decode-worker.
            bytes: source.slice(start, start + length),
          };
          live.postMessage(request, [request.bytes]);
        } catch (err) {
          retire(err instanceof Error ? err.message : String(err));
        }
      });
      if (answer?.ok) return answer.window;
      if (answer) retire(answer.message);
      return decodeInline(source, span);
    },

    dispose: stop,
  };
}

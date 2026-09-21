// Test-only Worker stand-in for the catalog-decode host. See ./README.md,
// the file roster.

import type {
  CatalogDecodeRequest,
  CatalogDecodeResponse,
} from './catalog-decode-worker';
import { decodeCatalogWindow } from './catalog-window';

export interface CatalogDecodeWorkerStub {
  /** Hand to `vi.stubGlobal('Worker', …)`. */
  Worker: new () => unknown;
  /** Every request posted to the stub, in order. */
  requests: CatalogDecodeRequest[];
  spawned(): number;
  terminated(): number;
  /** Fire `onerror` on the live instance, as a runtime killing the worker
   *  mid-flight does. */
  fail(message: string): void;
}

/** A Worker answering `reply` to whatever it is posted. Returning `null`
 *  leaves the request unanswered, for the `onerror` and no-reply paths to
 *  settle instead. */
export function stubCatalogDecodeWorker(
  reply: (req: CatalogDecodeRequest) => CatalogDecodeResponse | null,
): CatalogDecodeWorkerStub {
  const requests: CatalogDecodeRequest[] = [];
  let spawned = 0;
  let terminated = 0;
  let live: Stub | null = null;

  class Stub {
    onmessage: ((e: MessageEvent<CatalogDecodeResponse>) => void) | null = null;
    onerror: ((e: { message: string }) => void) | null = null;
    constructor() { spawned++; live = this; }
    postMessage(req: CatalogDecodeRequest) {
      requests.push(req);
      const answer = reply(req);
      if (answer) this.onmessage?.({ data: answer } as MessageEvent<CatalogDecodeResponse>);
    }
    terminate() { terminated++; }
  }

  return {
    Worker: Stub,
    requests,
    spawned: () => spawned,
    terminated: () => terminated,
    fail: (message) => live?.onerror?.({ message }),
  };
}

/** What a real worker sends back: the window decoded from the bytes it was
 *  handed. */
export function replyAsWorker(req: CatalogDecodeRequest): CatalogDecodeResponse {
  return {
    id: req.id,
    ok: true,
    window: decodeCatalogWindow(new DataView(req.bytes), req.first, req.count),
  };
}

/** A worker reporting the same decode failure for every window. */
export function replyWithFailure(
  message: string,
): (req: CatalogDecodeRequest) => CatalogDecodeResponse {
  return (req) => ({ id: req.id, ok: false, message });
}

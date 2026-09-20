// See ./README.md § The catalog-decode worker.

import { catalogWindowTransfers, decodeCatalogWindow } from './catalog-window';
import type { CatalogWindow } from './catalog-window';

export interface CatalogDecodeRequest {
  id: number;
  first: number;
  count: number;
  /** The window's records alone, starting at record `first`. */
  bytes: ArrayBuffer;
}

export type CatalogDecodeResponse =
  | { id: number; ok: true; window: CatalogWindow }
  | { id: number; ok: false; message: string };

self.onmessage = (event: MessageEvent<CatalogDecodeRequest>) => {
  const { id, first, count, bytes } = event.data;
  let window: CatalogWindow;
  try {
    window = decodeCatalogWindow(new DataView(bytes), first, count);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ id, ok: false, message } satisfies CatalogDecodeResponse);
    return;
  }
  self.postMessage(
    { id, ok: true, window } satisfies CatalogDecodeResponse,
    { transfer: catalogWindowTransfers(window) },
  );
};

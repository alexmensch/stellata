// See ./README.md § The catalog-decode worker.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FLAG_IS_SOL,
  RECORD_SIZE,
  readCatalogHeader,
  recordsOffset,
  type RecordSpan,
} from '../../../scripts/catalog/record/catalog-pure';
import { baseStar, buildCatalog } from './catalog-fixture';
import { createCatalogDecoder, decodeInline } from './catalog-decode-host';
import { decodeCatalogWindow } from './catalog-window';
import type { CatalogDecodeRequest, CatalogDecodeResponse } from './catalog-decode-worker';

const SOURCE = buildCatalog([
  { ...baseStar, x: 1 },
  { ...baseStar, x: 2 },
  { ...baseStar, x: 3, flags: FLAG_IS_SOL },
  { ...baseStar, x: 4 },
]);
const OFFSET = recordsOffset(readCatalogHeader(SOURCE));
const SPAN: RecordSpan = { offset: OFFSET, first: 1, end: 4 };

const requests: CatalogDecodeRequest[] = [];
let spawned = 0;

/** A Worker that answers `reply` to whatever it is posted. `null` leaves the
 *  request unanswered, for the `onerror` path to settle instead. */
function stubWorker(
  reply: (req: CatalogDecodeRequest) => CatalogDecodeResponse | null,
): { fail(message: string): void } {
  let live: StubWorker | null = null;
  class StubWorker {
    onmessage: ((e: MessageEvent<CatalogDecodeResponse>) => void) | null = null;
    onerror: ((e: { message: string }) => void) | null = null;
    constructor() { spawned++; live = this; }
    postMessage(req: CatalogDecodeRequest) {
      requests.push(req);
      const answer = reply(req);
      if (answer) this.onmessage?.({ data: answer } as MessageEvent<CatalogDecodeResponse>);
    }
    terminate() {}
  }
  vi.stubGlobal('Worker', StubWorker);
  return { fail: (message) => live?.onerror?.({ message }) };
}

/** What a real worker sends back: the window decoded from the bytes it was
 *  handed. */
function decodeAsWorker(req: CatalogDecodeRequest): CatalogDecodeResponse {
  return {
    id: req.id,
    ok: true,
    window: decodeCatalogWindow(new DataView(req.bytes), req.first, req.count),
  };
}

beforeEach(() => {
  requests.length = 0;
  spawned = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('createCatalogDecoder', () => {
  it('decodes inline where the runtime has no Worker', async () => {
    const window = await createCatalogDecoder().decode(SOURCE, SPAN);
    expect(window.first).toBe(1);
    expect(window.count).toBe(3);
    expect(window.solIndex).toBe(1);
  });

  it('hands the worker the window\'s records alone, and returns its window', async () => {
    stubWorker(decodeAsWorker);
    const window = await createCatalogDecoder().decode(SOURCE, SPAN);
    // Never the assembled buffer: transferring that would detach the bytes
    // the chunks still landing are written into.
    expect(requests[0].bytes.byteLength).toBe(3 * RECORD_SIZE);
    expect(requests[0].bytes).not.toBe(SOURCE);
    expect(SOURCE.byteLength).toBeGreaterThan(0);
    expect(window.columns.positions[0]).toBeCloseTo(2, 5);
    expect(window.solIndex).toBe(1);
  });

  it('keeps one worker across windows', async () => {
    stubWorker(decodeAsWorker);
    const decoder = createCatalogDecoder();
    await decoder.decode(SOURCE, { offset: OFFSET, first: 0, end: 2 });
    await decoder.decode(SOURCE, { offset: OFFSET, first: 2, end: 4 });
    expect(spawned).toBe(1);
    expect(requests.map((r) => r.id)).toEqual([0, 1]);
  });

  it('falls back to a window equal to the inline one when the worker throws', async () => {
    stubWorker((req) => ({ id: req.id, ok: false, message: 'boom' }));
    const window = await createCatalogDecoder().decode(SOURCE, SPAN);
    expect(window).toEqual(decodeInline(SOURCE, SPAN));
  });

  it('decodes inline for every window after a failure, without respawning', async () => {
    let answers = 0;
    stubWorker((req) => (answers++ === 0 ? { id: req.id, ok: false, message: 'boom' } : decodeAsWorker(req)));
    const decoder = createCatalogDecoder();
    await decoder.decode(SOURCE, { offset: OFFSET, first: 0, end: 2 });
    const second = await decoder.decode(SOURCE, { offset: OFFSET, first: 2, end: 4 });
    expect(spawned).toBe(1);
    expect(requests.length).toBe(1);
    expect(second).toEqual(decodeInline(SOURCE, { offset: OFFSET, first: 2, end: 4 }));
  });

  it('falls back when the worker constructor throws', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('blocked'); } });
    const window = await createCatalogDecoder().decode(SOURCE, SPAN);
    expect(window).toEqual(decodeInline(SOURCE, SPAN));
  });

  it('settles a window in flight when the worker errors out', async () => {
    const control = stubWorker(() => null);
    const decoder = createCatalogDecoder();
    const pending = decoder.decode(SOURCE, SPAN);
    control.fail('worker died');
    expect(await pending).toEqual(decodeInline(SOURCE, SPAN));
  });
});

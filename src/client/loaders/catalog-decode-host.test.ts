// See ./README.md#the-catalog-decode-worker.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FLAG_IS_SOL,
  RECORD_SIZE,
  readCatalogHeader,
  recordsOffset,
  type RecordSpan,
} from '../../../scripts/catalog/record/catalog-pure';
import { baseStar, buildCatalog } from './catalog-fixture';
import {
  replyAsWorker,
  replyWithFailure,
  stubCatalogDecodeWorker,
  type CatalogDecodeWorkerStub,
} from './catalog-decode-stub';
import { createCatalogDecoder, decodeInline } from './catalog-decode-host';
import type { CatalogDecodeRequest, CatalogDecodeResponse } from './catalog-decode-worker';

const SOURCE = buildCatalog([
  { ...baseStar, x: 1 },
  { ...baseStar, x: 2 },
  { ...baseStar, x: 3, flags: FLAG_IS_SOL },
  { ...baseStar, x: 4 },
]);
const OFFSET = recordsOffset(readCatalogHeader(SOURCE));
const SPAN: RecordSpan = { offset: OFFSET, first: 1, end: 4 };

function stubWorker(
  reply: (req: CatalogDecodeRequest) => CatalogDecodeResponse | null,
): CatalogDecodeWorkerStub {
  const stub = stubCatalogDecodeWorker(reply);
  vi.stubGlobal('Worker', stub.Worker);
  return stub;
}

beforeEach(() => {
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
    const stub = stubWorker(replyAsWorker);
    const window = await createCatalogDecoder().decode(SOURCE, SPAN);
    // Never the assembled buffer: transferring that would detach the bytes
    // the chunks still landing are written into.
    expect(stub.requests[0].bytes.byteLength).toBe(3 * RECORD_SIZE);
    expect(stub.requests[0].bytes).not.toBe(SOURCE);
    expect(SOURCE.byteLength).toBeGreaterThan(0);
    expect(window.columns.positions[0]).toBeCloseTo(2, 5);
    expect(window.solIndex).toBe(1);
  });

  it('keeps one worker across windows', async () => {
    const stub = stubWorker(replyAsWorker);
    const decoder = createCatalogDecoder();
    await decoder.decode(SOURCE, { offset: OFFSET, first: 0, end: 2 });
    await decoder.decode(SOURCE, { offset: OFFSET, first: 2, end: 4 });
    expect(stub.spawned()).toBe(1);
    expect(stub.requests.map((r) => r.id)).toEqual([0, 1]);
  });

  it('falls back to a window equal to the inline one when the worker throws', async () => {
    stubWorker(replyWithFailure('boom'));
    const window = await createCatalogDecoder().decode(SOURCE, SPAN);
    expect(window).toEqual(decodeInline(SOURCE, SPAN));
  });

  it('decodes inline for every window after a failure, without respawning', async () => {
    let answers = 0;
    const stub = stubWorker((req) => (
      answers++ === 0 ? replyWithFailure('boom')(req) : replyAsWorker(req)
    ));
    const decoder = createCatalogDecoder();
    await decoder.decode(SOURCE, { offset: OFFSET, first: 0, end: 2 });
    const second = await decoder.decode(SOURCE, { offset: OFFSET, first: 2, end: 4 });
    expect(stub.spawned()).toBe(1);
    expect(stub.requests.length).toBe(1);
    expect(second).toEqual(decodeInline(SOURCE, { offset: OFFSET, first: 2, end: 4 }));
  });

  it('falls back when the worker constructor throws', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('blocked'); } });
    const window = await createCatalogDecoder().decode(SOURCE, SPAN);
    expect(window).toEqual(decodeInline(SOURCE, SPAN));
  });

  it('settles a window in flight when the worker errors out', async () => {
    const stub = stubWorker(() => null);
    const decoder = createCatalogDecoder();
    const pending = decoder.decode(SOURCE, SPAN);
    stub.fail('worker died');
    expect(await pending).toEqual(decodeInline(SOURCE, SPAN));
  });
});

describe('the decoder\'s teardown', () => {
  it('terminates the worker and never respawns after dispose', async () => {
    const stub = stubWorker(replyAsWorker);
    const decoder = createCatalogDecoder();
    await decoder.decode(SOURCE, SPAN);
    decoder.dispose();
    expect(stub.terminated()).toBe(1);

    const after = await decoder.decode(SOURCE, SPAN);
    expect(after).toEqual(decodeInline(SOURCE, SPAN));
    expect(stub.spawned()).toBe(1);
    expect(stub.requests.length).toBe(1);
  });

  it('settles a window still in flight when disposed', async () => {
    stubWorker(() => null);
    const decoder = createCatalogDecoder();
    const pending = decoder.decode(SOURCE, SPAN);
    decoder.dispose();
    expect(await pending).toEqual(decodeInline(SOURCE, SPAN));
  });

  it('is idempotent', async () => {
    const stub = stubWorker(replyAsWorker);
    const decoder = createCatalogDecoder();
    await decoder.decode(SOURCE, SPAN);
    decoder.dispose();
    decoder.dispose();
    expect(stub.terminated()).toBe(1);
  });

  it('falls back inline when the worker never answers', async () => {
    vi.useFakeTimers();
    try {
      const stub = stubWorker(() => null);
      const decoder = createCatalogDecoder();
      const pending = decoder.decode(SOURCE, SPAN);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await pending).toEqual(decodeInline(SOURCE, SPAN));
      expect(stub.terminated()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves no timer behind on a window the worker answered', async () => {
    vi.useFakeTimers();
    try {
      stubWorker(replyAsWorker);
      await createCatalogDecoder().decode(SOURCE, SPAN);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

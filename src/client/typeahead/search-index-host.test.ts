// See ./README.md#the-search-index-worker.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchEntry } from '../../../scripts/catalog/record/catalog-pure';
import { loadSearchIndex } from './search-index-host';
import { buildSearchIndexPayload } from './search-index-payload';

const CONS = [{ code: 'Lyr', name: 'Lyrae', lines: [[0, 1]] }];
const ROWS: SearchEntry[] = [{ i: 1, p: 'Vega', hip: 91262, c: 0 }];

const bytesOf = (rows: SearchEntry[]): ArrayBuffer =>
  new TextEncoder().encode(JSON.stringify(rows)).buffer;

/** Answers `reply` to whatever it is posted. */
function stubWorker(reply: (req: { constellations: unknown }) => unknown) {
  const posted: { constellations: unknown }[] = [];
  class StubWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: { message: string }) => void) | null = null;
    postMessage(req: { constellations: unknown }) {
      posted.push(req);
      this.onmessage?.({ data: reply(req) } as MessageEvent);
    }
    terminate() {}
  }
  vi.stubGlobal('Worker', StubWorker);
  return posted;
}

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('loadSearchIndex', () => {
  it('derives inline where the runtime has no Worker', async () => {
    const { raw, tables } = await loadSearchIndex(bytesOf(ROWS), CONS);
    expect(raw).toEqual(ROWS);
    expect(tables.composedLabels.get(1)).toBe('Vega');
    expect(tables.corpus.hipMap.get(91262)).toBe(1);
  });

  it('returns the worker\'s tables rather than recomputing them', async () => {
    const fromWorker = buildSearchIndexPayload([{ i: 4, p: 'Sentinel', c: 0 }], CONS);
    stubWorker(() => ({ ok: true, payload: fromWorker }));
    const { raw, tables } = await loadSearchIndex(bytesOf(ROWS), CONS);
    // The entries are the main thread's own parse; the tables are the
    // worker's, so a host that recomputed would disagree on both.
    expect(raw).toEqual(ROWS);
    expect(tables).toBe(fromWorker);
  });

  it('falls back to tables equal to the inline ones when the worker fails', async () => {
    const expected = (await loadSearchIndex(bytesOf(ROWS), CONS)).tables;
    stubWorker(() => ({ ok: false, message: 'boom' }));
    const { tables } = await loadSearchIndex(bytesOf(ROWS), CONS);
    expect(tables.composedLabels).toEqual(expected.composedLabels);
    expect(tables.spectral).toEqual(expected.spectral);
    expect([...tables.corpus.hipMap]).toEqual([...expected.corpus.hipMap]);
  });

  it('falls back when the worker constructor throws', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('blocked'); } });
    const { tables } = await loadSearchIndex(bytesOf(ROWS), CONS);
    expect(tables.composedLabels.get(1)).toBe('Vega');
  });

  it('hands the worker only the code and name of each constellation', async () => {
    const posted = stubWorker(() => ({ ok: false, message: 'done' }));
    await loadSearchIndex(bytesOf(ROWS), CONS);
    // Asterism lines never cross — the composer reads code and name.
    expect(posted[0].constellations).toEqual([{ code: 'Lyr', name: 'Lyrae' }]);
  });
});

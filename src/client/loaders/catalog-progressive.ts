// Fetch and record-window scheduling for the progressive catalog load.
// See ./README.md#progressive-catalog-load.

import {
  catalogChunkFilename,
  recordsInChunkPrefix,
  type CatalogManifest,
  type RecordSpan,
} from '../../../scripts/catalog/record/catalog-pure';

export interface ChunkFetchDeps {
  /** Directory the chunk files are siblings of the manifest in. */
  dirUrl: string;
  manifest: CatalogManifest;
  /** Destination for every chunk's bytes — pre-sized to `totalBytes`. */
  into: Uint8Array;
  onBytes?: (delta: number) => void;
}

/** Fetch one chunk straight into its slice of the assembled buffer. Streams
 *  so the loading bar advances mid-chunk; the short-read guard rejects a
 *  truncated response, which would otherwise leave the pre-zeroed slice
 *  looking like valid records. */
async function fetchChunkInto(
  url: string,
  slice: Uint8Array,
  onBytes?: (delta: number) => void,
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  if (!res.body) {
    const whole = new Uint8Array(await res.arrayBuffer());
    if (whole.byteLength !== slice.byteLength) {
      throw new Error(
        `Catalog chunk short read at ${url}: got ${whole.byteLength}, expected ${slice.byteLength}`,
      );
    }
    slice.set(whole);
    onBytes?.(whole.byteLength);
    return;
  }
  const reader = res.body.getReader();
  let off = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    slice.set(value, off);
    off += value.byteLength;
    onBytes?.(value.byteLength);
  }
  if (off !== slice.byteLength) {
    throw new Error(
      `Catalog chunk short read at ${url}: got ${off}, expected ${slice.byteLength}`,
    );
  }
}

/** Each chunk's fetch, chained so exactly one is in flight at a time, each
 *  resolving into its own slice of the shared buffer. Index i settles when
 *  chunk i has landed. Serial, not parallel, and that is load-bearing:
 *  ./README.md#progressive-catalog-load. */
export function startChunkFetches({
  dirUrl, manifest, into, onBytes,
}: ChunkFetchDeps): Promise<void>[] {
  let off = 0;
  let chain: Promise<void> = Promise.resolve();
  return manifest.chunkBytes.map((byteLength, i) => {
    const slice = into.subarray(off, off + byteLength);
    off += byteLength;
    chain = chain.then(() => fetchChunkInto(dirUrl + catalogChunkFilename(i), slice, onBytes));
    // The caller awaits these in order and stops at the first failure, so
    // every chunk after it would otherwise reject with nothing attached.
    chain.catch(() => {});
    return chain;
  });
}

/** The record window chunk `index` completes, given the offset record 0
 *  sits at. Empty (`first === end`) when the chunk carries no whole record
 *  the prefix did not already cover — true of a chunk 0 that is all header
 *  and name table. */
export function chunkRecordSpan(
  manifest: CatalogManifest,
  index: number,
  offset: number,
  count: number,
): RecordSpan {
  const { chunkBytes } = manifest;
  return {
    offset,
    first: recordsInChunkPrefix(chunkBytes, index, offset, count),
    end: recordsInChunkPrefix(chunkBytes, index + 1, offset, count),
  };
}

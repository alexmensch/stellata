// Partial GPU re-upload for an instanced attribute whose per-frame writes
// land on a small, fixed subset of items. See src/client/util/README.md.

import type * as THREE from 'three';

/** Driver-call budget for one attribute's partial upload. Past it the
 *  whole buffer goes up as a single bufferSubData instead — a scattered
 *  dirty set costs more in calls than it saves in bytes. */
export const MAX_PARTIAL_RANGES = 64;

/** Two dirty items no further apart than this merge into one range: the
 *  clean payload in the gap is cheaper than an extra bufferSubData. */
export const RANGE_MERGE_GAP_ITEMS = 64;

/** Diff `array`'s tracked items against `shadow`, writing element-unit
 *  `[start, count]` ranges over the changed ones. `items` is an ascending
 *  list of item indices into `array`; `shadow` holds the last-flushed
 *  values of those items in `items` order, and is resynced here.
 *
 *  Returns the range count, or -1 when the changed set needs more than
 *  `MAX_PARTIAL_RANGES` ranges — the caller uploads in full. The shadow
 *  resyncs completely either way, so the next diff stays exact. */
export function diffItemsIntoRanges(
  items: Int32Array,
  itemSize: number,
  array: Float32Array,
  shadow: Float32Array,
  outStarts: Int32Array,
  outCounts: Int32Array,
): number {
  let n = 0;
  let overflow = false;
  let runStart = -1;
  let runEnd = -1;
  for (let k = 0; k < items.length; k++) {
    const item = items[k];
    const a = item * itemSize;
    const s = k * itemSize;
    let changed = false;
    for (let c = 0; c < itemSize; c++) {
      const v = array[a + c];
      if (v !== shadow[s + c]) {
        shadow[s + c] = v;
        changed = true;
      }
    }
    if (!changed || overflow) continue;
    if (runStart < 0) {
      runStart = item;
      runEnd = item;
    } else if (item - runEnd <= RANGE_MERGE_GAP_ITEMS) {
      runEnd = item;
    } else if (n === MAX_PARTIAL_RANGES) {
      overflow = true;
    } else {
      outStarts[n] = runStart * itemSize;
      outCounts[n] = (runEnd - runStart + 1) * itemSize;
      n++;
      runStart = item;
      runEnd = item;
    }
  }
  if (overflow) return -1;
  if (runStart >= 0) {
    if (n === MAX_PARTIAL_RANGES) return -1;
    outStarts[n] = runStart * itemSize;
    outCounts[n] = (runEnd - runStart + 1) * itemSize;
    n++;
  }
  return n;
}

/** Re-upload the whole buffer next render, discarding any partial ranges
 *  a previous flush left pending — three.js honours the ranges over the
 *  full array whenever the list is non-empty. */
export function uploadFull(attr: THREE.BufferAttribute): void {
  attr.clearUpdateRanges();
  attr.needsUpdate = true;
}

/** Re-uploads only the tracked items whose values changed since the last
 *  flush. One instance per attribute; `items` must be ascending. */
export class DirtyItemUploader {
  private readonly shadow: Float32Array;
  private readonly starts = new Int32Array(MAX_PARTIAL_RANGES);
  private readonly counts = new Int32Array(MAX_PARTIAL_RANGES);

  constructor(
    private readonly items: Int32Array,
    private readonly itemSize: number,
  ) {
    this.shadow = new Float32Array(items.length * itemSize);
  }

  /** `forceFull` still runs the diff, so a caller that rewrote items this
   *  uploader doesn't track (a wholesale buffer rewrite) resyncs the
   *  shadow in the same flush instead of leaking a stale baseline. */
  flush(attr: THREE.BufferAttribute, array: Float32Array, forceFull: boolean): void {
    const n = diffItemsIntoRanges(
      this.items, this.itemSize, array, this.shadow, this.starts, this.counts,
    );
    if (forceFull || n < 0) {
      uploadFull(attr);
      return;
    }
    if (n === 0) return;
    // Ranges a previous flush added are still pending when no render has
    // consumed them (the renderer clears the list on upload), so they
    // accumulate rather than being replaced.
    if (attr.updateRanges.length + n > MAX_PARTIAL_RANGES) {
      uploadFull(attr);
      return;
    }
    for (let i = 0; i < n; i++) attr.addUpdateRange(this.starts[i], this.counts[i]);
    attr.needsUpdate = true;
  }
}

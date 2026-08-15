import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  DirtyItemUploader,
  diffItemsIntoRanges,
  uploadFull,
  MAX_PARTIAL_RANGES,
  RANGE_MERGE_GAP_ITEMS,
} from './attribute-upload';

function harness(itemIndices: number[], itemSize: number, arrayItems: number) {
  const items = Int32Array.from(itemIndices);
  return {
    items,
    itemSize,
    array: new Float32Array(arrayItems * itemSize),
    shadow: new Float32Array(items.length * itemSize),
    starts: new Int32Array(MAX_PARTIAL_RANGES),
    counts: new Int32Array(MAX_PARTIAL_RANGES),
  };
}

function diff(h: ReturnType<typeof harness>): number {
  return diffItemsIntoRanges(
    h.items, h.itemSize, h.array, h.shadow, h.starts, h.counts,
  );
}

function ranges(h: ReturnType<typeof harness>, n: number): [number, number][] {
  return Array.from({ length: n }, (_, i) => [h.starts[i], h.counts[i]]);
}

describe('diffItemsIntoRanges', () => {
  it('reports every tracked item on the first diff, then nothing', () => {
    const h = harness([0, 1, 2], 3, 4);
    h.array.fill(1);
    expect(diff(h)).toBe(1);
    expect(ranges(h, 1)).toEqual([[0, 9]]);
    expect(diff(h)).toBe(0);
  });

  it('ignores changes to items outside the tracked set', () => {
    const h = harness([0, 1], 3, 4);
    diff(h);
    h.array[3 * 3] = 7;
    expect(diff(h)).toBe(0);
  });

  it('covers exactly the changed item at itemSize granularity', () => {
    const h = harness([0, 5, 9], 3, 10);
    diff(h);
    h.array[5 * 3 + 1] = 4;
    expect(diff(h)).toBe(1);
    expect(ranges(h, 1)).toEqual([[15, 3]]);
  });

  it('merges two changed items no further apart than the gap budget', () => {
    const near = RANGE_MERGE_GAP_ITEMS;
    const h = harness([0, near], 1, near + 1);
    diff(h);
    h.array[0] = 1;
    h.array[near] = 1;
    expect(diff(h)).toBe(1);
    expect(ranges(h, 1)).toEqual([[0, near + 1]]);
  });

  it('splits two changed items one item beyond the gap budget', () => {
    const far = RANGE_MERGE_GAP_ITEMS + 1;
    const h = harness([0, far], 1, far + 1);
    diff(h);
    h.array[0] = 1;
    h.array[far] = 1;
    expect(diff(h)).toBe(2);
    expect(ranges(h, 2)).toEqual([[0, 1], [far, 1]]);
  });

  it('returns -1 past the range budget, and still resyncs the shadow', () => {
    const stride = RANGE_MERGE_GAP_ITEMS + 1;
    const n = MAX_PARTIAL_RANGES + 1;
    const h = harness(
      Array.from({ length: n }, (_, i) => i * stride), 1, n * stride,
    );
    diff(h);
    for (let i = 0; i < n; i++) h.array[i * stride] = 1;
    expect(diff(h)).toBe(-1);
    // Resynced despite the overflow: the next frame diffs against the
    // values that went up in the full upload, not a stale baseline.
    expect(diff(h)).toBe(0);
  });

  it('reports a value returning to its previous float32 bits as unchanged', () => {
    const h = harness([0], 1, 1);
    h.array[0] = 5;
    diff(h);
    h.array[0] = 9;
    h.array[0] = 5;
    expect(diff(h)).toBe(0);
  });
});

describe('DirtyItemUploader', () => {
  const attrOf = (array: Float32Array, itemSize: number) =>
    new THREE.InstancedBufferAttribute(array, itemSize);

  it('reports every tracked item on the first flush — the GPU holds nothing yet', () => {
    const array = new Float32Array(9);
    const attr = attrOf(array, 3);
    const uploader = new DirtyItemUploader(attr, Int32Array.from([0, 1, 2]));
    uploader.flush(false);
    expect(attr.updateRanges).toEqual([{ start: 0, count: 9 }]);
  });

  it('reset re-reports every tracked item even though no value moved', () => {
    const array = new Float32Array(9);
    const attr = attrOf(array, 3);
    const uploader = new DirtyItemUploader(attr, Int32Array.from([0, 1, 2]));
    uploader.flush(false);
    attr.clearUpdateRanges();
    uploader.reset();
    uploader.flush(false);
    expect(attr.updateRanges).toEqual([{ start: 0, count: 9 }]);
  });

  it('leaves the attribute alone when nothing changed', () => {
    const array = new Float32Array(9);
    const attr = attrOf(array, 3);
    const uploader = new DirtyItemUploader(attr, Int32Array.from([0, 1, 2]));
    uploader.flush(false);
    attr.clearUpdateRanges();
    const version = attr.version;
    uploader.flush(false);
    expect(attr.version).toBe(version);
    expect(attr.updateRanges).toHaveLength(0);
  });

  it('forceFull uploads whole and discards pending ranges', () => {
    const array = new Float32Array(9);
    const attr = attrOf(array, 3);
    const uploader = new DirtyItemUploader(attr, Int32Array.from([0, 1, 2]));
    uploader.flush(true);
    array[0] = 1;
    uploader.flush(false);
    expect(attr.updateRanges).toHaveLength(1);
    array[4] = 1;
    uploader.flush(true);
    expect(attr.updateRanges).toHaveLength(0);
  });

  it('accumulates ranges across flushes no render consumed', () => {
    const stride = RANGE_MERGE_GAP_ITEMS + 1;
    const array = new Float32Array(3 * stride);
    const attr = attrOf(array, 1);
    const uploader = new DirtyItemUploader(
      attr, Int32Array.from([0, stride, 2 * stride]),
    );
    uploader.flush(true);
    array[0] = 1;
    uploader.flush(false);
    array[stride] = 1;
    uploader.flush(false);
    expect(attr.updateRanges).toEqual([{ start: 0, count: 1 }, { start: stride, count: 1 }]);
  });

  it('uploads in full once accumulated ranges cross the budget', () => {
    const stride = RANGE_MERGE_GAP_ITEMS + 1;
    // Two batches of three-quarters of the budget: each diff stays under
    // MAX_PARTIAL_RANGES, their accumulation does not.
    const perFlush = Math.ceil(MAX_PARTIAL_RANGES * 0.75);
    const items = Array.from({ length: perFlush * 2 }, (_, i) => i * stride);
    const array = new Float32Array(items.length * stride);
    const attr = attrOf(array, 1);
    const uploader = new DirtyItemUploader(attr, Int32Array.from(items));
    uploader.flush(true);
    for (let i = 0; i < perFlush; i++) array[items[i]] = 1;
    uploader.flush(false);
    expect(attr.updateRanges).toHaveLength(perFlush);
    const version = attr.version;
    // No render consumed the first batch, so the second batch's ranges push
    // the pending total past the budget and the whole buffer goes up.
    for (let i = perFlush; i < items.length; i++) array[items[i]] = 1;
    uploader.flush(false);
    expect(attr.updateRanges).toHaveLength(0);
    expect(attr.version).toBe(version + 1);
  });
});

describe('uploadFull', () => {
  it('bumps the version and clears any pending ranges', () => {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(3), 1);
    attr.addUpdateRange(0, 1);
    const version = attr.version;
    uploadFull(attr);
    expect(attr.updateRanges).toHaveLength(0);
    expect(attr.version).toBe(version + 1);
  });
});

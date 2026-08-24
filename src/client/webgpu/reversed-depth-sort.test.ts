import { describe, expect, it } from 'vitest';
import {
  reversedDepthOpaqueSort, reversedDepthTransparentSort, type RenderSortItem,
} from './reversed-depth-sort';

let nextId = 0;
function item(fields: Partial<RenderSortItem>): RenderSortItem {
  return {
    groupOrder: 0, renderOrder: 0, z: 0, id: nextId++, ...fields,
  };
}

/** What three does with the list: our comparator, then its own
 *  unconditional reverse under reversedDepthBuffer. */
function drawOrder(
  items: RenderSortItem[],
  sort: (a: RenderSortItem, b: RenderSortItem) => number,
): RenderSortItem[] {
  return [...items].sort(sort).reverse();
}

describe('the reversal lands on three’s intended order', () => {
  it('draws opaque items by ascending renderOrder', () => {
    // The bug this counters: the local pass drew its planet mesh (2.8)
    // AFTER the ring annulus (2.81), so the annulus never depth-tested
    // against the body.
    const mesh = item({ renderOrder: 2.8 });
    const rings = item({ renderOrder: 2.81 });
    const shell = item({ renderOrder: 2.82 });
    expect(drawOrder([shell, mesh, rings], reversedDepthOpaqueSort))
      .toEqual([mesh, rings, shell]);
  });

  it('draws opaque items front-to-back within one renderOrder', () => {
    const near = item({ z: 1 });
    const far = item({ z: 9 });
    expect(drawOrder([far, near], reversedDepthOpaqueSort)).toEqual([near, far]);
  });

  it('draws transparent items back-to-front within one renderOrder', () => {
    const near = item({ z: 1 });
    const far = item({ z: 9 });
    expect(drawOrder([near, far], reversedDepthTransparentSort)).toEqual([far, near]);
  });

  it('lets groupOrder outrank renderOrder on both lists', () => {
    const early = item({ groupOrder: -1, renderOrder: 99 });
    const late = item({ groupOrder: 1, renderOrder: -99 });
    for (const sort of [reversedDepthOpaqueSort, reversedDepthTransparentSort]) {
      expect(drawOrder([late, early], sort)).toEqual([early, late]);
    }
  });

  it('breaks ties on id, so reversing the order is exact', () => {
    // Without a total order the reverse is not an inverse: equal items
    // would come back in whatever order the sort left them.
    const first = item({});
    const second = item({});
    for (const sort of [reversedDepthOpaqueSort, reversedDepthTransparentSort]) {
      expect(drawOrder([second, first], sort)).toEqual([first, second]);
    }
  });

  it('treats a recycled entry’s nulls as zero rather than NaN', () => {
    const nulls: RenderSortItem = {
      groupOrder: null, renderOrder: null, z: null, id: null,
    };
    const zeros = item({ id: 1 });
    for (const sort of [reversedDepthOpaqueSort, reversedDepthTransparentSort]) {
      expect(sort(nulls, zeros)).toBe(1);
      expect(Number.isNaN(sort(nulls, nulls))).toBe(false);
    }
  });
});

// Render-list comparators that counter r185's reversed-depth list
// reversal. Retire with the three bump — see boot-webgpu.ts.

/** The fields three's own comparators read off a render item. Nullable
 *  because a list entry is recycled rather than rebuilt. */
export interface RenderSortItem {
  groupOrder: number | null;
  renderOrder: number | null;
  z: number | null;
  id: number | null;
}

/**
 * r185's `RenderList.sort` REVERSES every sorted list when the renderer
 * runs a reversed depth buffer, which inverts `renderOrder` contracts
 * renderer-wide: the local pass drew its planet mesh AFTER the ring
 * annulus, and the main pass its star glow before the disc. Upstream has
 * since deleted the reversal outright.
 *
 * The sort hooks run BEFORE that reversal, custom or not, so negating
 * every key here pre-inverts the order and the reversal lands back on
 * three's intended one. `id` breaks ties, so the composed order is total
 * and reversing it is exact rather than merely stable.
 */
export function reversedDepthOpaqueSort(a: RenderSortItem, b: RenderSortItem): number {
  return (b.groupOrder ?? 0) - (a.groupOrder ?? 0)
    || (b.renderOrder ?? 0) - (a.renderOrder ?? 0)
    || (b.z ?? 0) - (a.z ?? 0)
    || (b.id ?? 0) - (a.id ?? 0);
}

/** The transparent list's twin: three sorts it back-to-front, so only
 *  the `z` key inverts relative to the opaque comparator above. */
export function reversedDepthTransparentSort(a: RenderSortItem, b: RenderSortItem): number {
  return (b.groupOrder ?? 0) - (a.groupOrder ?? 0)
    || (b.renderOrder ?? 0) - (a.renderOrder ?? 0)
    || (a.z ?? 0) - (b.z ?? 0)
    || (b.id ?? 0) - (a.id ?? 0);
}

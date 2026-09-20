// Layout of the static per-star storage table: one record of
// STAR_STATIC_STRIDE floats per catalogue star, field order = roster order.

import { STAR_STATIC_FIELDS, type StarStaticField } from '../star-attribute-roster';

/** Padded to whole vec4s for headroom, not alignment — scalar reads out of a
 *  float table need none. A twelfth static field costs no bytes; a thirteenth
 *  takes the stride to 16, so sixteen bytes per star. */
export const STAR_STATIC_STRIDE = Math.ceil(STAR_STATIC_FIELDS.length / 4) * 4;

export function staticSlot(field: StarStaticField): number {
  const slot = STAR_STATIC_FIELDS.indexOf(field);
  if (slot < 0) throw new Error(`not a static star field: ${field}`);
  return slot;
}

/** Element index of `field` for star `idx` — what the shader computes. */
export function staticElement(idx: number, field: StarStaticField): number {
  return idx * STAR_STATIC_STRIDE + staticSlot(field);
}

export type StaticFieldSources = Readonly<Record<StarStaticField, ArrayLike<number>>>;

/** Pad slots stay 0. */
export function buildStaticTable(sources: StaticFieldSources, count: number): Float32Array {
  const table = new Float32Array(count * STAR_STATIC_STRIDE);
  writeStaticTable(sources, table, count, 0, count);
  return table;
}

/** `buildStaticTable` over one record window. The table is a COPY of the
 *  eleven source columns, so a progressive load that refills the columns
 *  alone never reaches the GPU — the window has to be re-interleaved and
 *  its range flagged on the storage attribute. */
export function writeStaticTable(
  sources: StaticFieldSources,
  table: Float32Array,
  count: number,
  first: number,
  end: number,
): void {
  for (const field of STAR_STATIC_FIELDS) {
    const src = sources[field];
    if (src.length !== count) {
      throw new Error(`static star field ${field}: ${src.length} values for ${count} stars`);
    }
    const slot = staticSlot(field);
    for (let i = first; i < end; i++) table[i * STAR_STATIC_STRIDE + slot] = src[i];
  }
}

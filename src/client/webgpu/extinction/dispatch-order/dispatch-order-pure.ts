// Morton (Z-order) dispatch order for the extinction kernel: the permutation
// that lands spatially adjacent stars on adjacent GPU threads, and the
// scatter that undoes it. README.md § Dispatch order.

import { sortIndicesByKeyWords } from '../../../util/radix-sort';

/** A ceiling, not a preference — README.md § Dispatch order. */
export const MORTON_BITS_PER_AXIS = 16;

const AXIS_MAX = (1 << MORTON_BITS_PER_AXIS) - 1;
const HALF_SHIFT = MORTON_BITS_PER_AXIS >> 1;
const HALF_MASK = (1 << HALF_SHIFT) - 1;

/** Spread the low 8 bits of `n` over every third bit of a 24-bit word. */
function part1By2(n: number): number {
  let v = n & 0xff;
  v = (v ^ (v << 16)) & 0xff0000ff;
  v = (v ^ (v << 8)) & 0x0300f00f;
  v = (v ^ (v << 4)) & 0x030c30c3;
  v = (v ^ (v << 2)) & 0x09249249;
  return v >>> 0;
}

function interleave(x: number, y: number, z: number): number {
  return (part1By2(x) | (part1By2(y) << 1) | (part1By2(z) << 2)) >>> 0;
}

/** Dispatch slot → star index, ordered so consecutive slots hold stars close
 *  in 3D. Why spatial and not angular: README.md § Dispatch order. */
export function mortonDispatchOrder(positions: Float32Array, count: number): Uint32Array {
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const scaleX = maxX > minX ? AXIS_MAX / (maxX - minX) : 0;
  const scaleY = maxY > minY ? AXIS_MAX / (maxY - minY) : 0;
  const scaleZ = maxZ > minZ ? AXIS_MAX / (maxZ - minZ) : 0;

  const hi = new Uint32Array(count);
  const lo = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const qx = ((positions[i * 3] - minX) * scaleX) | 0;
    const qy = ((positions[i * 3 + 1] - minY) * scaleY) | 0;
    const qz = ((positions[i * 3 + 2] - minZ) * scaleZ) | 0;
    hi[i] = interleave(qx >>> HALF_SHIFT, qy >>> HALF_SHIFT, qz >>> HALF_SHIFT);
    lo[i] = interleave(qx & HALF_MASK, qy & HALF_MASK, qz & HALF_MASK);
  }
  return sortIndicesByKeyWords([lo, hi], 0, count);
}

/** Sort `positions` into `order` (slot → star) and write its inverse into
 *  `slotOf[0, count)` (star → slot), what a kernel handed a star index needs
 *  to find that star in the slot-indexed position table. `slotOf` may run
 *  past `count`; the rest is left alone. */
export function writeDispatchTablesInto(
  order: Uint32Array,
  slotOf: Uint32Array,
  positions: Float32Array,
  count: number,
): void {
  order.set(mortonDispatchOrder(positions, count));
  for (let i = 0; i < count; i++) slotOf[order[i]] = i;
}

/** Undo the permutation: element `i` of `src` belongs to star `order[i]`. */
export function scatterByOrder(
  src: Float32Array,
  order: Uint32Array,
  count: number,
  srcStride = 1,
): Float32Array {
  const out = new Float32Array(count);
  const outBits = new Uint32Array(out.buffer);
  const srcBits = new Uint32Array(src.buffer, src.byteOffset, src.length);
  for (let i = 0; i < count; i++) outBits[order[i]] = srcBits[i * srcStride];
  return out;
}

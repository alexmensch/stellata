// Morton (Z-order) dispatch order for the extinction kernel: the permutation
// that lands spatially adjacent stars on adjacent GPU threads, and the
// scatter that undoes it. README.md § Dispatch order.

/**
 * Bits of each axis quantised into the key, and the ceiling rather than a
 * preference: the spreader below takes 8 bits at a time and the key is
 * built from two halves, and three 16-bit axes interleave into 48 bits,
 * which is the most a float64 sort key holds exactly. Raising it drops the
 * high bits of every coordinate and silently collapses the order.
 */
export const MORTON_BITS_PER_AXIS = 16;

const AXIS_MAX = (1 << MORTON_BITS_PER_AXIS) - 1;
const HALF_SHIFT = MORTON_BITS_PER_AXIS >> 1;
const HALF_MASK = (1 << HALF_SHIFT) - 1;
const HALF_SCALE = 2 ** (3 * HALF_SHIFT);

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

/**
 * Dispatch slot → star index, ordered so that consecutive slots hold stars
 * that are close in 3D. The key is spatial rather than angular on purpose:
 * a sky-direction order is coherent only from the vantage it was built for,
 * and the camera flies anywhere (AGENTS.md § Camera-anywhere).
 */
export function mortonDispatchOrder(positions: Float32Array, count: number): Uint32Array {
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  if (count < 2) return order;

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
  // A degenerate axis quantises to zero rather than dividing by it.
  const scaleX = maxX > minX ? AXIS_MAX / (maxX - minX) : 0;
  const scaleY = maxY > minY ? AXIS_MAX / (maxY - minY) : 0;
  const scaleZ = maxZ > minZ ? AXIS_MAX / (maxZ - minZ) : 0;

  const keys = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const qx = ((positions[i * 3] - minX) * scaleX) | 0;
    const qy = ((positions[i * 3 + 1] - minY) * scaleY) | 0;
    const qz = ((positions[i * 3 + 2] - minZ) * scaleZ) | 0;
    keys[i] = interleave(qx >>> HALF_SHIFT, qy >>> HALF_SHIFT, qz >>> HALF_SHIFT) * HALF_SCALE
      + interleave(qx & HALF_MASK, qy & HALF_MASK, qz & HALF_MASK);
  }
  order.sort((a, b) => keys[a] - keys[b] || a - b);
  return order;
}

/**
 * Undo the permutation: element `i` of `src` belongs to star `order[i]`.
 * Moves float32 bit patterns rather than values, so a NaN payload survives
 * the trip and the parity check stays a bit comparison.
 */
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

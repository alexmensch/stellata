// Plan + pack N named per-instance scalars into ceil(N/4) vec4 buffers.
// Why packing exists at all: README.md § Attribute packing.

export type PackedComponent = 'x' | 'y' | 'z' | 'w';

const COMPONENTS: readonly PackedComponent[] = ['x', 'y', 'z', 'w'];

export const DEFAULT_PACK_PREFIX = 'iPack';

export interface PackedSlot {
  buffer: number;
  component: 0 | 1 | 2 | 3;
}

export interface Vec4PackPlan {
  readonly names: readonly string[];
  readonly bufferCount: number;
  readonly slots: Readonly<Record<string, PackedSlot>>;
  /** Attribute-name prefix. Fixed at plan time so the geometry's buffer
   *  names and the accessor nodes cannot disagree — a mismatch would read
   *  an attribute nothing ever set, silently, with no throw. */
  readonly prefix: string;
}

export function planVec4Packing(
  names: readonly string[],
  prefix = DEFAULT_PACK_PREFIX,
): Vec4PackPlan {
  // Null-prototype: `'toString' in slots` is true on a plain object, which
  // would both false-trigger the duplicate throw and hand slotFor a
  // function instead of undefined.
  const slots: Record<string, PackedSlot> = Object.create(null);
  names.forEach((name, i) => {
    if (name in slots) throw new Error(`duplicate packed attribute: ${name}`);
    slots[name] = { buffer: i >> 2, component: (i & 3) as PackedSlot['component'] };
  });
  return { names, bufferCount: Math.ceil(names.length / 4), slots, prefix };
}

function slotFor(plan: Vec4PackPlan, name: string): PackedSlot {
  const slot = plan.slots[name];
  if (slot === undefined) throw new Error(`not in the pack plan: ${name}`);
  return slot;
}

export function packedBufferName(plan: Vec4PackPlan, buffer: number): string {
  return `${plan.prefix}${buffer}`;
}

/** Where a scalar reads from: the vec4 attribute's name and the swizzle
 *  component carrying it. */
export function packedAccess(
  plan: Vec4PackPlan,
  name: string,
): { buffer: string; component: PackedComponent } {
  const slot = slotFor(plan, name);
  return { buffer: packedBufferName(plan, slot.buffer), component: COMPONENTS[slot.component] };
}

/** Interleave the named per-instance scalars into the plan's vec4
 *  buffers. Unfilled tail components of the last buffer stay 0. */
export function packVec4Buffers(
  plan: Vec4PackPlan,
  sources: Readonly<Record<string, ArrayLike<number>>>,
  count: number,
): Float32Array[] {
  const buffers = Array.from({ length: plan.bufferCount }, () => new Float32Array(count * 4));
  for (const name of plan.names) {
    const src = sources[name];
    if (src === undefined) throw new Error(`missing packed attribute source: ${name}`);
    repackScalarInPlace(plan, buffers, name, src);
  }
  return buffers;
}

/** Rewrite one scalar's component of its packed buffer in place — the
 *  path a DynamicDrawUsage source takes when it alone changed. Returns
 *  the index of the buffer written so the caller can flag its upload. */
export function repackScalarInPlace(
  plan: Vec4PackPlan,
  buffers: readonly Float32Array[],
  name: string,
  src: ArrayLike<number>,
): number {
  const { buffer, component } = slotFor(plan, name);
  const dst = buffers[buffer];
  const count = dst.length >> 2;
  if (src.length !== count) {
    throw new Error(`packed attribute ${name}: ${src.length} values for ${count} instances`);
  }
  for (let i = 0; i < count; i++) dst[i * 4 + component] = src[i];
  return buffer;
}

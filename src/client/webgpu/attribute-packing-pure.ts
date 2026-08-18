// Plan + pack N named per-instance scalars into ceil(N/4) vec4 buffers.
// Why packing exists at all: README.md § Attribute packing.

export interface PackedSlot {
  buffer: number;
  component: 0 | 1 | 2 | 3;
}

export interface Vec4PackPlan {
  readonly names: readonly string[];
  readonly bufferCount: number;
  readonly slots: Readonly<Record<string, PackedSlot>>;
}

export function planVec4Packing(names: readonly string[]): Vec4PackPlan {
  const slots: Record<string, PackedSlot> = {};
  names.forEach((name, i) => {
    if (name in slots) throw new Error(`duplicate packed attribute: ${name}`);
    slots[name] = { buffer: i >> 2, component: (i & 3) as PackedSlot['component'] };
  });
  return { names, bufferCount: Math.ceil(names.length / 4), slots };
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
    if (src.length !== count) {
      throw new Error(`packed attribute ${name}: ${src.length} values for ${count} instances`);
    }
    const { buffer, component } = plan.slots[name];
    const dst = buffers[buffer];
    for (let i = 0; i < count; i++) dst[i * 4 + component] = src[i];
  }
  return buffers;
}

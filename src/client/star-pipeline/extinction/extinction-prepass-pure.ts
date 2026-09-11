// Pure helpers for the per-star A_V prepass: texture geometry, position
// packing, and the camera-displacement invalidation predicate.

/** Fixed width of the star-indexed prepass textures; star i lives at
 *  texel (i % width, i / width) in both the position texture and the
 *  A_V render target. The GLSL side derives it via textureSize() so no
 *  shader constant can drift from this one. */
export const AV_TEX_WIDTH = 1024;

/** Camera displacement (pc) beyond which the cached per-star A_V is
 *  recomputed. Worst-case drift while stale is peak voxel density
 *  (~1e-3) × A_V-rate (2.742 mag/pc) ≈ 0.003 mag per pc moved —
 *  imperceptible, while keeping close-range orbiting (AU-scale motion)
 *  entirely recompute-free. */
export const RECOMPUTE_EPSILON_PC = 1.0;

export function avTexHeight(count: number): number {
  return Math.ceil(count / AV_TEX_WIDTH);
}

/** Pack xyz star positions into vec4 slots (w untouched): star i at
 *  `out[4i..4i+2]`. `out` is the caller's — a `count × 4` storage array,
 *  or the padded texture below. */
export function packPositionsVec4Into<T extends Float32Array>(
  out: T,
  positions: Float32Array,
  count: number,
): T {
  for (let i = 0; i < count; i++) {
    out[i * 4] = positions[i * 3];
    out[i * 4 + 1] = positions[i * 3 + 1];
    out[i * 4 + 2] = positions[i * 3 + 2];
  }
  return out;
}

/** Pack xyz star positions into RGBA float texels (alpha unused);
 *  padding texels beyond `count` stay zero. */
export function packPositionsRgba(
  positions: Float32Array,
  count: number,
): Float32Array<ArrayBuffer> {
  return packPositionsVec4Into(
    new Float32Array(AV_TEX_WIDTH * avTexHeight(count) * 4), positions, count);
}

/** True when the camera has moved beyond epsilon from the last-computed
 *  position. An Infinity component (the first-frame sentinel) always
 *  returns true. */
export function movedBeyondEpsilon(
  lastX: number, lastY: number, lastZ: number,
  x: number, y: number, z: number,
  epsilonPc: number,
): boolean {
  const dx = x - lastX;
  const dy = y - lastY;
  const dz = z - lastZ;
  return dx * dx + dy * dy + dz * dz > epsilonPc * epsilonPc;
}

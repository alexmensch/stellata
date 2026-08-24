import * as THREE from 'three';

// Bytes a texel occupies for a three format/type pair, and the factor a
// mip chain adds. One table, charged by both the planet-map VRAM budget
// and the memory inventory.

const PACKED_TEXEL_BYTES = new Map<number, number>([
  [THREE.UnsignedShort4444Type, 2],
  [THREE.UnsignedShort5551Type, 2],
  [THREE.UnsignedInt248Type, 4],
  [THREE.UnsignedInt5999Type, 4],
]);

const CHANNELS = new Map<number, number>([
  [THREE.AlphaFormat, 1],
  [THREE.RedFormat, 1],
  [THREE.RedIntegerFormat, 1],
  [THREE.DepthFormat, 1],
  [THREE.RGFormat, 2],
  [THREE.RGIntegerFormat, 2],
  [THREE.RGBAFormat, 4],
  [THREE.RGBAIntegerFormat, 4],
]);

const CHANNEL_BYTES = new Map<number, number>([
  [THREE.ByteType, 1],
  [THREE.UnsignedByteType, 1],
  [THREE.ShortType, 2],
  [THREE.UnsignedShortType, 2],
  [THREE.HalfFloatType, 2],
  [THREE.IntType, 4],
  [THREE.UnsignedIntType, 4],
  [THREE.FloatType, 4],
]);

/** Bytes one texel occupies, or null for a format/type pair not in the
 *  tables — a compressed format, or one three grew after this was
 *  written. Callers report null; none of them may read it as zero. */
export function texelBytes(
  format: THREE.AnyPixelFormat,
  type: THREE.TextureDataType,
): number | null {
  const packed = PACKED_TEXEL_BYTES.get(type);
  if (packed !== undefined) return packed;
  const channels = CHANNELS.get(format);
  const perChannel = CHANNEL_BYTES.get(type);
  if (channels === undefined || perChannel === undefined) return null;
  return channels * perChannel;
}

/** A full mip chain adds exactly a third over the base level
 *  (1 + ¼ + 1/16 + …). */
export const MIP_CHAIN_FACTOR = 4 / 3;

const MIPMAP_MIN_FILTERS = new Set<number>([
  THREE.NearestMipmapNearestFilter,
  THREE.NearestMipmapLinearFilter,
  THREE.LinearMipmapNearestFilter,
  THREE.LinearMipmapLinearFilter,
]);

/** Three uploads a chain only when the minification filter samples it,
 *  so `generateMipmaps` — which defaults to TRUE — does not by itself
 *  mean the memory is spent. Keying on the flag alone inflates every
 *  `NearestFilter` data texture in the app by a third. */
export function mipmapFactor(texture: THREE.Texture): number {
  const chained = texture.generateMipmaps && MIPMAP_MIN_FILTERS.has(texture.minFilter);
  return chained ? MIP_CHAIN_FACTOR : 1;
}

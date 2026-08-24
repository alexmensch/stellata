import * as THREE from 'three';

// Byte math for the GPU-residency inventory: how many bytes a texture or
// a geometry actually occupies, and how to render the totals.

export type ByteBasis = 'array' | 'format' | 'unknown';

export interface ResidencyRow {
  label: string;
  bytes: number;
  /** `array` — the resource's own CPU-side buffer length, exact.
   *  `format` — derived from dimensions × format × type.
   *  `unknown` — neither was available; `bytes` is 0 and the row is
   *  counted as unaccounted rather than as free. */
  basis: ByteBasis;
  detail: string;
}

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
 *  written. Null is reported, never silently treated as zero. */
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

const MIPMAP_MIN_FILTERS = new Set<number>([
  THREE.NearestMipmapNearestFilter,
  THREE.NearestMipmapLinearFilter,
  THREE.LinearMipmapNearestFilter,
  THREE.LinearMipmapLinearFilter,
]);

/** A full mip chain adds a third again over the base level. Three uploads
 *  one only when the minification filter samples it, so `generateMipmaps`
 *  alone does not mean the memory is spent. */
export function mipmapFactor(texture: THREE.Texture): number {
  const chained = texture.generateMipmaps && MIPMAP_MIN_FILTERS.has(texture.minFilter);
  return chained ? 4 / 3 : 1;
}

interface TextureImage {
  data?: ArrayBufferView;
  width?: number;
  height?: number;
  depth?: number;
}

/** Resident bytes for one texture. Prefers the CPU-side array length,
 *  which is exact for every DataTexture the app builds; falls back to
 *  dimensions × texel size for image-backed textures, whose decoded
 *  bytes live only on the GPU. */
export function textureBytes(texture: THREE.Texture): { bytes: number; basis: ByteBasis; detail: string } {
  const image = texture.image as TextureImage | undefined;
  const depth = image?.depth && image.depth > 0 ? image.depth : 1;
  const dims = image?.width && image?.height
    ? `${image.width}×${image.height}${depth > 1 ? `×${depth}` : ''}`
    : '?';
  const mips = mipmapFactor(texture);
  const mipNote = mips > 1 ? ' +mips' : '';

  if (image?.data && ArrayBuffer.isView(image.data)) {
    return {
      bytes: Math.round(image.data.byteLength * mips),
      basis: 'array',
      detail: `${dims}${mipNote}`,
    };
  }

  const texel = texelBytes(texture.format, texture.type);
  if (texel === null || !image?.width || !image?.height) {
    return { bytes: 0, basis: 'unknown', detail: `${dims} format=${texture.format} type=${texture.type}` };
  }
  return {
    bytes: Math.round(image.width * image.height * depth * texel * mips),
    basis: 'format',
    detail: `${dims}${mipNote} ${texel}B/texel`,
  };
}

/** Resident bytes for one geometry: every attribute array plus the index.
 *  Interleaved attributes share one buffer, so they are counted through
 *  the buffer they view rather than once per attribute. */
export function geometryBytes(geometry: THREE.BufferGeometry): { bytes: number; detail: string } {
  const counted = new Set<ArrayBufferLike>();
  let bytes = 0;
  let attributes = 0;
  const add = (array: ArrayBufferView | undefined): void => {
    if (!array || counted.has(array.buffer)) return;
    counted.add(array.buffer);
    bytes += array.byteLength;
  };
  for (const attribute of Object.values(geometry.attributes)) {
    attributes++;
    const interleaved = (attribute as THREE.InterleavedBufferAttribute).data;
    add(interleaved ? interleaved.array as ArrayBufferView : attribute.array as ArrayBufferView);
  }
  add(geometry.index?.array as ArrayBufferView | undefined);
  return { bytes, detail: `${attributes} attr${geometry.index ? ' + index' : ''}` };
}

export function totalBytes(rows: readonly ResidencyRow[]): number {
  let sum = 0;
  for (const row of rows) sum += row.bytes;
  return sum;
}

export function unknownCount(rows: readonly ResidencyRow[]): number {
  let n = 0;
  for (const row of rows) if (row.basis === 'unknown') n++;
  return n;
}

const UNITS = ['B', 'KiB', 'MiB', 'GiB'] as const;

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const decimals = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${UNITS[unit]}`;
}

/** Sum the distinct typed arrays hanging off a plain object — the catalog
 *  bag and its kin. Views sharing one ArrayBuffer (a parsed artifact
 *  sliced into columns) are counted once, against the first name that
 *  reaches them, so the total is what the heap actually holds. */
export function typedArrayRows(source: object, prefix: string): ResidencyRow[] {
  const counted = new Set<ArrayBufferLike>();
  const rows: ResidencyRow[] = [];
  for (const [name, value] of Object.entries(source)) {
    if (!ArrayBuffer.isView(value)) continue;
    if (counted.has(value.buffer)) {
      rows.push({
        label: `${prefix}.${name}`,
        bytes: 0,
        basis: 'array',
        detail: `shares a buffer already counted (${value.byteLength} B view)`,
      });
      continue;
    }
    counted.add(value.buffer);
    const elements = value.byteLength
      / (value as ArrayBufferView & { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT;
    const partial = value.byteLength < value.buffer.byteLength;
    rows.push({
      // The heap retains the whole ArrayBuffer, so the row charges the
      // buffer rather than the view — a column view of a parsed artifact
      // keeps every other column's bytes alive with it.
      label: `${prefix}.${name}`,
      bytes: value.buffer.byteLength,
      basis: 'array',
      detail: `${value.constructor.name}[${elements}]${partial ? ' — view of a larger buffer, charged in full' : ''}`,
    });
  }
  return rows;
}

export function byBytesDescending(a: ResidencyRow, b: ResidencyRow): number {
  return b.bytes - a.bytes;
}

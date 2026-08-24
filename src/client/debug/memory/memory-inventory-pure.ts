import * as THREE from 'three';
import { mipmapFactor, texelBytes } from '../../util/texture-bytes-pure';

// Row shapes for the GPU-residency inventory, the byte math that fills
// them, and the aggregation the console print reads.

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
  /** Identical resources folded into this row; `bytes` is their sum. */
  count?: number;
}

interface TextureImage {
  data?: ArrayBufferView;
  width?: number;
  height?: number;
  depth?: number;
}

/** Resident bytes for one texture. Prefers the CPU-side array length,
 *  which is exact for every DataTexture the app builds; falls back to
 *  dimensions × texel size for image-backed textures and render-target
 *  attachments, whose bytes live only on the GPU. */
export function textureResidency(
  texture: THREE.Texture,
): { bytes: number; basis: ByteBasis; detail: string } {
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
    return {
      bytes: 0,
      basis: 'unknown',
      detail: `${dims} format=${texture.format} type=${texture.type}`,
    };
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

/** Fold rows describing the same resource at the same size into one,
 *  summing bytes and counting the copies.
 *
 *  The default view parents several hundred identically-shaped orbit
 *  rings and boundary loops, and one row each buries the handful that
 *  hold real memory — a table nobody can read is a table nobody re-runs.
 *  Rows already carrying a `count` keep summing, so grouping twice is
 *  the same as grouping once. */
export function groupRows(rows: readonly ResidencyRow[]): ResidencyRow[] {
  const byKey = new Map<string, ResidencyRow>();
  for (const row of rows) {
    const key = `${row.basis}|${row.label}|${row.detail}`;
    const seen = byKey.get(key);
    const count = row.count ?? 1;
    if (seen === undefined) {
      byKey.set(key, { ...row, count });
      continue;
    }
    seen.bytes += row.bytes;
    seen.count = (seen.count ?? 1) + count;
  }
  return [...byKey.values()];
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

/** Field names `typedArrayRows` could not price, so the print can say so
 *  rather than leaving them silently absent. A `Map` of proper names or
 *  an array of constellation records holds real heap and no row. */
export function unpricedFields(source: object): string[] {
  const names: string[] = [];
  for (const [name, value] of Object.entries(source)) {
    if (ArrayBuffer.isView(value)) continue;
    if (value === null || typeof value !== 'object') continue;
    names.push(name);
  }
  return names;
}

export function byBytesDescending(a: ResidencyRow, b: ResidencyRow): number {
  return b.bytes - a.bytes;
}

export interface ResourceCounts {
  geometries: number;
  textures: number;
}

export interface CrossCheck {
  /** What three's own bookkeeping counts as uploaded. */
  renderer: ResourceCounts;
  /** What the scene walk reached. */
  walked: ResourceCounts;
  /** Uploaded but off-scene — render targets, and anything parented into
   *  a scene the walk does not visit. */
  offScene: ResourceCounts;
  /** Walked but never uploaded. Three counts a geometry when the draw
   *  path first asks for its buffers, so a scene-graph resource missing
   *  from its count has no GPU allocation at all: the walk charges bytes
   *  the device is not holding. Over-counting is the safe direction, but
   *  it has to be visible or the total reads as residency. */
  unuploaded: ResourceCounts;
}

export function crossCheck(renderer: ResourceCounts, walked: ResourceCounts): CrossCheck {
  return {
    renderer,
    walked,
    offScene: {
      geometries: Math.max(0, renderer.geometries - walked.geometries),
      textures: Math.max(0, renderer.textures - walked.textures),
    },
    unuploaded: {
      geometries: Math.max(0, walked.geometries - renderer.geometries),
      textures: Math.max(0, walked.textures - renderer.textures),
    },
  };
}

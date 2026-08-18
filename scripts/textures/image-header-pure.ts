// Reading a shipped image's own header, so a pin reads the artifact rather
// than the manifest or the prose written beside it.

/** True when the file is an LFS pointer stub rather than the object — a
 *  checkout that never pulled LFS, where anything reading bytes must skip
 *  rather than fail. */
export const isLfsPointer = (buf: Buffer): boolean =>
  buf.subarray(0, 7).toString('ascii') === 'version';

/** Dimensions out of a lossless-WebP (VP8L) header: 14-bit width−1 and
 *  height−1 packed little-endian after the 0x2f signature byte. */
export function webpSize(buf: Buffer, label: string): {
  width: number;
  height: number;
} {
  if (buf.subarray(0, 4).toString('ascii') !== 'RIFF') {
    throw new Error(`${label}: not a RIFF container`);
  }
  if (buf.subarray(12, 16).toString('ascii') !== 'VP8L') {
    throw new Error(`${label}: not lossless WebP`);
  }
  const bits = buf.readUInt32LE(21);
  return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
}

export interface ImageSize { width: number; height: number }

/** Dimensions from a JPEG's first start-of-frame marker. Walks the segment
 *  chain rather than scanning for the marker bytes, which appear inside
 *  entropy-coded data too. */
export function jpegSize(buf: Buffer, label: string): ImageSize {
  if (buf.readUInt16BE(0) !== 0xffd8) throw new Error(`${label}: not a JPEG`);
  let p = 2;
  while (p + 4 <= buf.length) {
    if (buf[p] !== 0xff) throw new Error(`${label}: desynced at ${p}`);
    const marker = buf[p + 1];
    // Standalone markers carry no length; SOF0-SOF15 hold the frame header,
    // less the four arithmetic-coding and DHT/JPG slots sharing that range.
    if (marker >= 0xc0 && marker <= 0xcf
        && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(p + 5), width: buf.readUInt16BE(p + 7) };
    }
    p += 2 + buf.readUInt16BE(p + 2);
  }
  throw new Error(`${label}: no start-of-frame marker`);
}

/** Dimensions from a baseline TIFF's first IFD — tags 0x0100 / 0x0101. */
export function tiffSize(buf: Buffer, label: string): ImageSize {
  const le = buf.subarray(0, 2).toString('ascii') === 'II';
  if (!le && buf.subarray(0, 2).toString('ascii') !== 'MM') {
    throw new Error(`${label}: not a TIFF`);
  }
  const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const ifd = u32(4);
  const out: Partial<ImageSize> = {};
  for (let i = 0; i < u16(ifd); i++) {
    const e = ifd + 2 + i * 12;
    const tag = u16(e);
    if (tag !== 0x0100 && tag !== 0x0101) continue;
    // SHORT (3) sits in the low half of the value field; LONG (4) fills it.
    const v = u16(e + 2) === 3 ? u16(e + 8) : u32(e + 8);
    if (tag === 0x0100) out.width = v;
    else out.height = v;
  }
  if (out.width === undefined || out.height === undefined) {
    throw new Error(`${label}: no dimension tags in the first IFD`);
  }
  return { width: out.width, height: out.height };
}

/** Dispatch on extension — the provenance table names files, not formats. */
export function imageSize(buf: Buffer, name: string): ImageSize {
  if (name.endsWith('.webp')) return webpSize(buf, name);
  if (name.endsWith('.jpg')) return jpegSize(buf, name);
  if (name.endsWith('.tif')) return tiffSize(buf, name);
  throw new Error(`${name}: no header reader for this extension`);
}

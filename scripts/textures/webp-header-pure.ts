// Reading a shipped lossless WebP's own header, so an artifact pin reads the
// artifact rather than the manifest written beside it.

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

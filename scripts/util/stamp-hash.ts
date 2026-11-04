// The one hash every stamp-side digest is taken with. See README.md.

import { createHash } from 'node:crypto';
import { closeSync, openSync, readSync } from 'node:fs';

const HASH_CHUNK_BYTES = 1 << 22;

const stampHash = () => createHash('sha1');

export function hashFile(path: string): string {
  const hash = stampHash();
  const buf = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
  const fd = openSync(path, 'r');
  try {
    for (let n; (n = readSync(fd, buf)) > 0;) hash.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

/** `hashFile` of a file holding exactly `bytes`. */
export function hashBytes(bytes: string | Uint8Array): string {
  return stampHash().update(bytes).digest('hex');
}

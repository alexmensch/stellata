import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { HASH_CHUNK_BYTES, hashBytes, hashFile } from './stamp-hash';

describe('stamp hash', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('is sha1 in hex', () => {
    expect(hashBytes('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(hashBytes('a\n')).toBe('3f786850e387550fdab836ed7e6dc881de23001b');
  });

  it('hashes a file as the bytes it holds', () => {
    dir = mkdtempSync(join(tmpdir(), 'stamp-hash-'));
    const bytes = new Uint8Array([0, 1, 2, 255]);
    writeFileSync(join(dir, 'f.bin'), bytes);
    expect(hashFile(join(dir, 'f.bin'))).toBe(hashBytes(bytes));
  });

  it('hashes a file longer than one read chunk as the bytes it holds', () => {
    dir = mkdtempSync(join(tmpdir(), 'stamp-hash-'));
    const bytes = new Uint8Array(HASH_CHUNK_BYTES + 1).map((_, i) => i % 251);
    writeFileSync(join(dir, 'big.bin'), bytes);
    expect(hashFile(join(dir, 'big.bin'))).toBe(hashBytes(bytes));
  });
});

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  isLfsPointer,
  isLfsPointerFile,
  lfsContentReadable,
} from './paths';

const LFS_STUB = 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12\n';

describe('paths / LFS pointer detection', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lfsprobe-'));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('recognises a pointer stub and rejects real content', () => {
    expect(isLfsPointer(LFS_STUB)).toBe(true);
    expect(isLfsPointer('ra\tdec\tcon\n')).toBe(false);
    expect(isLfsPointer('')).toBe(false);
  });

  it('reads a stub off disk', () => {
    const stub = join(dir, 'stub.tsv');
    writeFileSync(stub, LFS_STUB);
    expect(isLfsPointerFile(stub)).toBe(true);
  });

  it('reads smudged content off disk', () => {
    const real = join(dir, 'real.tsv');
    writeFileSync(real, 'ra\tdec\tcon\n');
    expect(isLfsPointerFile(real)).toBe(false);
  });

  // The probe reads a fixed-size head, so a file shorter than the probe
  // window must not be mistaken for a truncated pointer.
  it('handles a file shorter than the probe window', () => {
    const tiny = join(dir, 'tiny.tsv');
    writeFileSync(tiny, 'x');
    expect(isLfsPointerFile(tiny)).toBe(false);
  });

  it('reads content only for a present, smudged file', () => {
    const stub = join(dir, 'readable-stub.tsv');
    const real = join(dir, 'readable-real.tsv');
    writeFileSync(stub, LFS_STUB);
    writeFileSync(real, 'ra\tdec\tcon\n');
    expect(lfsContentReadable(real)).toBe(true);
    expect(lfsContentReadable(stub)).toBe(false);
    expect(lfsContentReadable(join(dir, 'absent.tsv'))).toBe(false);
  });
});

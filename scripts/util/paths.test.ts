import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isLfsPointer, isLfsPointerFile, maxMtimeOfSources } from './paths';

const LFS_STUB = 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12\n';

describe('paths / maxMtimeOfSources', () => {
  let dir: string;
  let older: string;
  let newer: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'maxmtime-'));
    older = join(dir, 'older.txt');
    newer = join(dir, 'newer.txt');
    writeFileSync(older, 'a');
    writeFileSync(newer, 'b');
    utimesSync(older, new Date(1_000), new Date(1_000));
    utimesSync(newer, new Date(2_000), new Date(2_000));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('returns the max mtime across present paths', () => {
    expect(maxMtimeOfSources([older, newer])).toBe(2_000);
  });

  it('ignores missing paths', () => {
    expect(maxMtimeOfSources([join(dir, 'nope.txt'), older])).toBe(1_000);
  });

  it('returns 0 when every path is missing', () => {
    expect(maxMtimeOfSources([join(dir, 'a'), join(dir, 'b')])).toBe(0);
  });

  it('returns 0 for an empty list', () => {
    expect(maxMtimeOfSources([])).toBe(0);
  });
});

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
});

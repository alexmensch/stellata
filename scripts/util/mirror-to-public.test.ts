import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { syncFile } from './mirror-to-public';
import { REPO_ROOT } from './paths';

mkdirSync(join(REPO_ROOT, 'build'), { recursive: true });
const dir = mkdtempSync(join(REPO_ROOT, 'build', 'mirror-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('syncFile', () => {
  it('copies a new or changed file and skips one already in place', () => {
    const src = join(dir, 'src.bin');
    const dst = join(dir, 'dst.bin');
    writeFileSync(src, 'abc');
    expect(syncFile(src, dst)).toBe('copied');
    expect(syncFile(src, dst)).toBe('up-to-date');

    writeFileSync(src, 'abcd');
    expect(syncFile(src, dst)).toBe('copied');
    expect(readFileSync(dst, 'utf8')).toBe('abcd');

    const later = new Date(Date.now() + 60_000);
    utimesSync(src, later, later);
    expect(syncFile(src, dst)).toBe('copied');
  });
});

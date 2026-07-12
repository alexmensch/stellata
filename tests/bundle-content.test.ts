// Deployed-bundle content guard: no source-tree docs/scripts may leak
// into public/ (and thence dist/) via sync scripts that mirror data/
// folders. Self-skips when public/ hasn't been built (bare CI test job).

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import { isDustPublicAsset } from '../scripts/dust/sync-dust-pure';

const PUBLIC_DIR = resolve(__dirname, '..', 'public');
const FORBIDDEN_EXTENSIONS = ['.md', '.txt', '.py', '.ts'];

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
  return out;
}

describe.skipIf(!existsSync(PUBLIC_DIR))('deployed bundle content (public/)', () => {
  it('contains no source-tree file types', () => {
    const offenders = walkFiles(PUBLIC_DIR).filter((p) =>
      FORBIDDEN_EXTENSIONS.some((ext) => p.endsWith(ext)),
    );
    expect(offenders).toEqual([]);
  });

  it('public/dust/ holds only allowlisted dust assets', () => {
    const dustDir = join(PUBLIC_DIR, 'dust');
    if (!existsSync(dustDir)) return;
    const offenders = readdirSync(dustDir).filter((name) => !isDustPublicAsset(name));
    expect(offenders).toEqual([]);
  });
});

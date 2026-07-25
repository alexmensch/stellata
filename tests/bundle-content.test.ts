// Deployed-bundle content guard: no source-tree docs/scripts may leak
// into public/ (and thence dist/) via sync scripts that mirror data/
// folders. Self-skips when public/ hasn't been built (bare CI test job).

import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import { isDustPublicAsset } from '../scripts/dust/sync-dust-pure';
import { isProbePublicAsset } from '../scripts/probes/sync-probes-pure';
import { isTexturePublicAsset } from '../scripts/textures/sync-textures-pure';

const PUBLIC_DIR = resolve(__dirname, '..', 'public');
// One row per mirrored folder; the predicate is the same one
// scripts/util/mirror-to-public.ts syncs and purges with.
const MIRRORED_FOLDERS: Array<[string, (name: string) => boolean]> = [
  ['dust', isDustPublicAsset],
  ['textures', isTexturePublicAsset],
  ['probes', isProbePublicAsset],
];
const FORBIDDEN_EXTENSIONS = ['.md', '.txt', '.py', '.ts'];
// Committed .txt assets that are meant to ship (crawler + AI-agent signals).
const ALLOWED_SHIPPED = new Set(['robots.txt', 'llms.txt']);

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
    const offenders = walkFiles(PUBLIC_DIR).filter(
      (p) =>
        FORBIDDEN_EXTENSIONS.some((ext) => p.endsWith(ext)) &&
        !ALLOWED_SHIPPED.has(basename(p)),
    );
    expect(offenders).toEqual([]);
  });

  it.each(MIRRORED_FOLDERS)('public/%s/ holds only allowlisted assets', (folder, isAllowed) => {
    const dir = join(PUBLIC_DIR, folder);
    if (!existsSync(dir)) return;
    const offenders = readdirSync(dir).filter((name) => !isAllowed(name));
    expect(offenders).toEqual([]);
  });
});

// Deployed-bundle content guard: no source-tree docs/scripts may leak
// into public/ (and thence dist/) via sync scripts that mirror data/
// folders. Self-skips when public/ hasn't been built (bare CI test job).

import { existsSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import { walkFiles } from './walk-files';

import { isDustPublicAsset } from '../scripts/dust/sync-dust-pure';
import { isPlanetElementPublicAsset } from '../scripts/ephemerides/sync-ephemerides-pure';
import { isProbePublicAsset } from '../scripts/probes/sync-probes-pure';
import { isTexturePublicAsset } from '../scripts/textures/sync-textures-pure';
import { STAGING_SUFFIX } from '../scripts/util/staged-write';

const PUBLIC_DIR = resolve(__dirname, '..', 'public');
const DIST_DIR = resolve(__dirname, '..', 'dist');
// One row per mirrored folder; the predicate is the same one
// scripts/util/mirror-to-public.ts syncs and purges with.
const MIRRORED_FOLDERS: Array<[string, (name: string) => boolean]> = [
  ['dust', isDustPublicAsset],
  ['textures', isTexturePublicAsset],
  ['probes', isProbePublicAsset],
  ['ephemerides', isPlanetElementPublicAsset],
];
const FORBIDDEN_EXTENSIONS = ['.md', '.txt', '.py', '.ts'];
// Committed .txt assets that are meant to ship (crawler signals).
const ALLOWED_SHIPPED = new Set(['robots.txt']);

describe.skipIf(!existsSync(PUBLIC_DIR))('deployed bundle content (public/)', () => {
  it('contains no source-tree file types', () => {
    const offenders = [...walkFiles(PUBLIC_DIR)].filter(
      (p) =>
        FORBIDDEN_EXTENSIONS.some((ext) => p.endsWith(ext)) &&
        !ALLOWED_SHIPPED.has(basename(p)),
    );
    expect(offenders).toEqual([]);
  });

  it('holds no staged output a killed build left behind, in public/ or dist/', () => {
    const offenders = [PUBLIC_DIR, DIST_DIR]
      .filter((d) => existsSync(d))
      .flatMap((d) => [...walkFiles(d)])
      .filter((p) => p.endsWith(STAGING_SUFFIX));
    expect(offenders).toEqual([]);
  });

  it.each(MIRRORED_FOLDERS)('public/%s/ holds only allowlisted assets', (folder, isAllowed) => {
    const dir = join(PUBLIC_DIR, folder);
    if (!existsSync(dir)) return;
    const offenders = readdirSync(dir).filter((name) => !isAllowed(name));
    expect(offenders).toEqual([]);
  });
});

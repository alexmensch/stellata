/**
 * Build-time values every Vite config in the repo publishes, so the app and
 * the public site read one set.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { catalogChunkFilename, readCatalogHeader } from './scripts/catalog/catalog-pure.ts';

/**
 * The star count, read from the built catalogue's own header — never a
 * literal, so it cannot outlive the catalogue it describes. Empty string
 * on a checkout that has not run `build:catalog`; every consumer needs a
 * wording that works without it (`docs/authoring-patterns.md` § The star
 * count is never a literal).
 */
function builtStarCount(root: string): string {
  try {
    const buf = readFileSync(resolve(root, 'public', catalogChunkFilename(0)));
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return readCatalogHeader(bytes as ArrayBuffer).count.toLocaleString('en-US');
  } catch {
    return '';
  }
}

/**
 * The VITE_ prefix is the supported way to inject build-time values that
 * work in both dev and prod (`define` behaves differently across the two).
 */
export function publishBuildEnv(root: string): void {
  process.env.VITE_APP_VERSION = JSON.parse(
    readFileSync(resolve(root, 'package.json'), 'utf8'),
  ).version;
  process.env.VITE_STAR_COUNT = builtStarCount(root);
}

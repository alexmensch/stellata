import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { catalogChunkFilename, readCatalogHeader } from './scripts/catalog/catalog-pure.ts';

// Expose package.json version as `import.meta.env.VITE_APP_VERSION`. The
// VITE_ prefix is the supported way to inject build-time values that work
// in both dev and prod (define behaves differently across the two).
const pkgVersion: string = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8'),
).version;
process.env.VITE_APP_VERSION = pkgVersion;

/**
 * The star count, read from the built catalogue's own header — never a
 * literal, so it cannot outlive the catalogue it describes. Empty string
 * on a checkout that has not run `build:catalog`; every consumer needs a
 * wording that works without it (`docs/authoring-patterns.md` § The star
 * count is never a literal).
 */
function builtStarCount(): string {
  try {
    const buf = readFileSync(resolve(import.meta.dirname, 'public', catalogChunkFilename(0)));
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return readCatalogHeader(bytes as ArrayBuffer).count.toLocaleString('en-US');
  } catch {
    return '';
  }
}
process.env.VITE_STAR_COUNT = builtStarCount();

export default defineConfig(() => ({
  base: '/',
  root: resolve(import.meta.dirname, 'src/client'),
  publicDir: resolve(import.meta.dirname, 'public'),
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: resolve(import.meta.dirname, 'src/client/index.html'),
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: [resolve(import.meta.dirname, '..')],
    },
  },
}));

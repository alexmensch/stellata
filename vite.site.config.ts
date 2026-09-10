import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { markdownRendition } from './scripts/site/markdown-rendition.ts';
import { publishBuildEnv } from './vite.env.ts';

publishBuildEnv(import.meta.dirname);

/**
 * Each page's markdown rendition, emitted beside the document it renders —
 * `src/site/index.html` → `dist/index.md`, served at `/index.md`. Derived
 * from the authored page rather than authored beside it, so the two cannot
 * come to state different things. `src/site/README.md` § The markdown
 * rendition.
 */
function markdownRenditions(pages: Record<string, string>): Plugin {
  return {
    name: 'stellata:markdown-renditions',
    apply: 'build',
    generateBundle() {
      for (const [name, page] of Object.entries(pages)) {
        this.emitFile({
          type: 'asset',
          fileName: name,
          source: markdownRendition(readFileSync(page, 'utf8')),
        });
      }
    },
  };
}

const HOME = resolve(import.meta.dirname, 'src/site/index.html');

export default defineConfig(() => ({
  base: '/',
  plugins: [markdownRenditions({ 'index.md': HOME })],
  root: resolve(import.meta.dirname, 'src/site'),
  // The app pass already copied public/ into dist/. Copying it twice
  // would only re-walk the built catalogue chunks.
  publicDir: false,
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    // The app pass owns emptying dist/, and it runs first.
    emptyOutDir: false,
    target: 'es2020',
    rollupOptions: {
      // One key per page. The key is cosmetic; the emitted path is the
      // input's own path relative to `root`, which is what puts the
      // homepage at dist/index.html and so serves it at /.
      input: {
        home: HOME,
        // Emitted at dist/404.html, which is the filename Cloudflare's
        // not_found_handling = "404-page" looks for.
        notFound: resolve(import.meta.dirname, 'src/site/404.html'),
      },
    },
  },
  server: {
    port: 5174,
  },
}));

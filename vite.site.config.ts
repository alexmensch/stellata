import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { markdownRendition } from './scripts/site/markdown-rendition.ts';
import { NOT_FOUND_SOURCE, SITE_PAGES, renditionPath } from './src/site/pages.ts';
import { publishBuildEnv } from './vite.env.ts';

publishBuildEnv(import.meta.dirname);

const SITE_DIR = resolve(import.meta.dirname, 'src/site');

/** src/site/README.md#the-markdown-rendition--how-an-agent-reads-these-pages. */
function markdownRenditions(): Plugin {
  return {
    name: 'stellata:markdown-renditions',
    apply: 'build',
    generateBundle() {
      for (const page of SITE_PAGES) {
        const rendition = renditionPath(page);
        if (rendition === null) continue;
        this.emitFile({
          type: 'asset',
          fileName: rendition.slice(1),
          source: markdownRendition(readFileSync(resolve(SITE_DIR, page.source), 'utf8')),
        });
      }
    },
  };
}

export default defineConfig(() => ({
  base: '/',
  plugins: [markdownRenditions()],
  root: SITE_DIR,
  // Both of these belong to the app pass, which runs first. Reversing
  // either wipes dist/ — src/site/README.md#the-build-seam.
  publicDir: false,
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: false,
    target: 'es2020',
    rollupOptions: {
      input: [...SITE_PAGES.map((page) => page.source), NOT_FOUND_SOURCE].map((source) =>
        resolve(SITE_DIR, source),
      ),
    },
  },
  server: {
    port: 5174,
  },
}));

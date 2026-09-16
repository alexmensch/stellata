import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { markdownRendition } from './scripts/site/markdown-rendition.ts';
import { publishBuildEnv } from './vite.env.ts';

publishBuildEnv(import.meta.dirname);

/** `src/site/README.md` § The markdown rendition. */
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
  // Both of these belong to the app pass, which runs first. Reversing
  // either wipes dist/ — src/site/README.md § The build seam.
  publicDir: false,
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: false,
    target: 'es2020',
    rollupOptions: {
      // src/site/README.md § A page's path is its folder.
      input: {
        home: HOME,
        notFound: resolve(import.meta.dirname, 'src/site/404.html'),
      },
    },
  },
  server: {
    port: 5174,
  },
}));

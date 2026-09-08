import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { publishBuildEnv } from './vite.env.ts';

publishBuildEnv(import.meta.dirname);

export default defineConfig(() => ({
  base: '/',
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
        home: resolve(import.meta.dirname, 'src/site/index.html'),
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

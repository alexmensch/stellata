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
      // input's own path relative to `root`, which is what puts the page
      // at dist/home/index.html and so serves it at /home.
      input: {
        home: resolve(import.meta.dirname, 'src/site/home/index.html'),
      },
    },
  },
  server: {
    port: 5174,
  },
}));

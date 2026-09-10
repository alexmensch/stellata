import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { publishBuildEnv } from './vite.env.ts';
import { documentRoutingInDev } from './vite.site-dev.ts';

publishBuildEnv(import.meta.dirname);

export default defineConfig(() => ({
  base: '/',
  // One dev server answers the deploy's whole URL space: the app at /app,
  // the homepage at /, the 404 page for anything else. 'custom' hands
  // document routing to the plugin — Vite's own SPA fallback rewrites an
  // unmatched path to /index.html before any plugin middleware sees it.
  appType: 'custom' as const,
  plugins: [documentRoutingInDev(import.meta.dirname)],
  root: resolve(import.meta.dirname, 'src/client'),
  publicDir: resolve(import.meta.dirname, 'public'),
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    // Sits above the entry chunk on purpose. JS is ~1% of the bytes before
    // first frame (the catalogue fetch dominates), and a three/app vendor
    // split leaves both halves near 500 kB, so it silences nothing.
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      // Emitted at its own path relative to `root`, which is the URL it
      // serves at: dist/app/index.html -> /app. `src/client/app/README.md`
      // is why the document sits in a folder of its own while `base`
      // stays `/`.
      input: resolve(import.meta.dirname, 'src/client/app/index.html'),
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: [resolve(import.meta.dirname, '..')],
    },
  },
}));

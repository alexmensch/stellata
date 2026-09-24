import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { publishBuildEnv } from './vite.env.ts';
import { documentRoutingInDev } from './vite.site-dev.ts';

publishBuildEnv(import.meta.dirname);

export default defineConfig(() => ({
  base: '/',
  // Drop it and Vite's fallback serves the homepage for every path.
  // src/site/README.md#reading-it-in-dev.
  appType: 'custom' as const,
  plugins: [documentRoutingInDev(import.meta.dirname)],
  root: resolve(import.meta.dirname, 'src/client'),
  publicDir: resolve(import.meta.dirname, 'public'),
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    // src/client/app/README.md#the-chunk-size-limit-is-raised-not-chased.
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      // src/client/app/README.md#why-one-file-has-a-folder-to-itself.
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

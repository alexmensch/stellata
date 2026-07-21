// Copies the committed data/molecular-clouds/cloud-surfaces.bin →
// public/ (gitignored) so the build serves it without astro-Python.
// Missing source is not an error; see the folder README.

import { existsSync, mkdirSync, statSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const SRC = resolve(ROOT, 'data/molecular-clouds/cloud-surfaces.bin');
const DST = resolve(ROOT, 'public/cloud-surfaces.bin');

function main(): void {
  if (!existsSync(SRC)) {
    console.log('data/molecular-clouds/cloud-surfaces.bin not found; skipping.');
    return;
  }
  mkdirSync(dirname(DST), { recursive: true });
  if (existsSync(DST)) {
    const s = statSync(SRC);
    const d = statSync(DST);
    if (d.size === s.size && d.mtimeMs >= s.mtimeMs) {
      console.log('public/cloud-surfaces.bin up to date.');
      return;
    }
  }
  copyFileSync(SRC, DST);
  console.log(`synced cloud-surfaces.bin (${statSync(DST).size} bytes).`);
}

main();

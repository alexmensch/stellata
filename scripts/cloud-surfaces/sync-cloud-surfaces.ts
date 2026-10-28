// Copies the committed data/molecular-clouds/cloud-surfaces.bin →
// public/ (gitignored) so the build serves it without astro-Python. See the folder README.

import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { REPO_ROOT } from '../util/paths';
import { CLOUD_SURFACES_BIN } from './cloud-surfaces-source';

const DST = resolve(REPO_ROOT, 'public/cloud-surfaces.bin');

function main(): void {
  const src = CLOUD_SURFACES_BIN.read();
  mkdirSync(dirname(DST), { recursive: true });
  if (existsSync(DST)) {
    const s = statSync(src);
    const d = statSync(DST);
    if (d.size === s.size && d.mtimeMs >= s.mtimeMs) {
      console.log('public/cloud-surfaces.bin up to date.');
      return;
    }
  }
  copyFileSync(src, DST);
  console.log(`synced cloud-surfaces.bin (${statSync(DST).size} bytes).`);
}

main();

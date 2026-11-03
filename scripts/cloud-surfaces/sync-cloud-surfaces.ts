// Copies the committed data/molecular-clouds/cloud-surfaces.bin →
// public/ (gitignored) so the build serves it without astro-Python. See the folder README.

import { mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

import { syncFile } from '../util/mirror-to-public';
import { publicFile } from '../util/paths';
import { PUBLIC_FILES, publicRepoPath } from '../../src/catalog-format/public-artifacts/public-artifacts';
import { CLOUD_SURFACES_BIN } from './cloud-surfaces-source';

const DST = publicFile(PUBLIC_FILES.cloudSurfaces);

function main(): void {
  const src = CLOUD_SURFACES_BIN.read();
  mkdirSync(dirname(DST), { recursive: true });
  if (syncFile(src, DST) === 'up-to-date') {
    console.log(`${publicRepoPath(PUBLIC_FILES.cloudSurfaces)} up to date.`);
    return;
  }
  console.log(`synced ${PUBLIC_FILES.cloudSurfaces} (${statSync(DST).size} bytes).`);
}

main();

// Copies the committed data/local-bubble/local-bubble.bin → public/
// (gitignored) so the build serves it without astro-Python. See the folder README.

import { mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { syncFile } from '../util/mirror-to-public';
import { REPO_ROOT } from '../util/paths';
import { LOCAL_BUBBLE_BIN } from './local-bubble-source';

const DST = resolve(REPO_ROOT, 'public/local-bubble.bin');

function main(): void {
  const src = LOCAL_BUBBLE_BIN.read();
  mkdirSync(dirname(DST), { recursive: true });
  if (syncFile(src, DST) === 'up-to-date') {
    console.log('public/local-bubble.bin up to date.');
    return;
  }
  console.log(`synced local-bubble.bin (${statSync(DST).size} bytes).`);
}

main();

// Copies the committed data/local-bubble/local-bubble.bin → public/
// (gitignored) so the build serves it without astro-Python. See the folder README.

import { mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

import { syncFile } from '../util/mirror-to-public';
import { publicFile } from '../util/paths';
import { PUBLIC_FILES, publicRepoPath } from '../../src/catalog-format/public-artifacts/public-artifacts';
import { LOCAL_BUBBLE_BIN } from './local-bubble-source';

const DST = publicFile(PUBLIC_FILES.localBubble);

function main(): void {
  const src = LOCAL_BUBBLE_BIN.read();
  mkdirSync(dirname(DST), { recursive: true });
  if (syncFile(src, DST) === 'up-to-date') {
    console.log(`${publicRepoPath(PUBLIC_FILES.localBubble)} up to date.`);
    return;
  }
  console.log(`synced ${PUBLIC_FILES.localBubble} (${statSync(DST).size} bytes).`);
}

main();

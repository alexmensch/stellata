// Copies the committed data/local-bubble/local-bubble.bin → public/
// (gitignored) so the build serves it without astro-Python. Missing
// source is not an error — the shell is optional. See the folder README.

import { existsSync, mkdirSync, statSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const SRC = resolve(ROOT, 'data/local-bubble/local-bubble.bin');
const DST = resolve(ROOT, 'public/local-bubble.bin');

function main(): void {
  if (!existsSync(SRC)) {
    console.log('data/local-bubble/local-bubble.bin not found; skipping.');
    return;
  }
  mkdirSync(dirname(DST), { recursive: true });
  if (existsSync(DST)) {
    const s = statSync(SRC);
    const d = statSync(DST);
    if (d.size === s.size && d.mtimeMs >= s.mtimeMs) {
      console.log('public/local-bubble.bin up to date.');
      return;
    }
  }
  copyFileSync(SRC, DST);
  console.log(`synced local-bubble.bin (${statSync(DST).size} bytes).`);
}

main();

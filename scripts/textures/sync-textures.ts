// Mirrors data/textures/ (committed artifacts) → public/textures/
// (gitignored) so Vite + the Cloudflare static-asset build serve the
// per-body maps. Missing data/textures/ is not an error.

import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isTexturePublicAsset } from './sync-textures-pure';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..', '..');
const SRC = resolve(ROOT, 'data/textures');
const DST = resolve(ROOT, 'public/textures');

function main() {
  if (!existsSync(SRC)) {
    console.log('data/textures/ not found; skipping texture sync.');
    return;
  }
  mkdirSync(DST, { recursive: true });

  let copied = 0;
  let skipped = 0;
  for (const name of readdirSync(SRC)) {
    if (!isTexturePublicAsset(name)) continue;
    const srcPath = resolve(SRC, name);
    const dstPath = resolve(DST, name);
    const srcStat = statSync(srcPath);
    if (!srcStat.isFile()) continue;
    if (existsSync(dstPath)) {
      const dstStat = statSync(dstPath);
      if (dstStat.size === srcStat.size && dstStat.mtimeMs >= srcStat.mtimeMs) {
        skipped++;
        continue;
      }
    }
    copyFileSync(srcPath, dstPath);
    copied++;
  }
  console.log(`texture sync: ${copied} copied, ${skipped} up to date.`);
}

main();

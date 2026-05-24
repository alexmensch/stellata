// Mirrors data/dust/ (LFS-tracked source of truth) → public/dust/
// (gitignored) so Vite + the Cloudflare static-asset build serve the
// voxel chunks. Missing data/dust/ is not an error — dust is optional.

import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..', '..');
const SRC = resolve(ROOT, 'data/dust');
const DST = resolve(ROOT, 'public/dust');

function main() {
  if (!existsSync(SRC)) {
    console.log('data/dust/ not found; skipping dust sync.');
    return;
  }
  mkdirSync(DST, { recursive: true });

  let copied = 0;
  let skipped = 0;
  for (const name of readdirSync(SRC)) {
    // Skip dotfiles. build-dust.py emits .voxels.npy as a 512 MiB
    // intermediate that lives alongside the chunks; it has no business
    // in public/ (Cloudflare Workers caps assets at 25 MiB).
    if (name.startsWith('.')) continue;
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
  console.log(`dust sync: ${copied} copied, ${skipped} up-to-date`);
}

main();

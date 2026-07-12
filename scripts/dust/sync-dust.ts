// Mirrors data/dust/ (LFS-tracked source of truth) → public/dust/
// (gitignored) so Vite + the Cloudflare static-asset build serve the
// voxel chunks. Missing data/dust/ is not an error — dust is optional.

import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isDustPublicAsset } from './sync-dust-pure';

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
    // Allowlist, not denylist: data/dust/ also holds README.md and
    // build-dust.py's .voxels.npy intermediate (512 MiB — Cloudflare
    // Workers caps assets at 25 MiB); neither may reach public/.
    if (!isDustPublicAsset(name)) continue;
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

  // Purge disallowed strays a previous (pre-allowlist) sync mirrored in;
  // Vite copies public/ wholesale, so anything left here ships.
  let purged = 0;
  for (const name of readdirSync(DST)) {
    if (isDustPublicAsset(name)) continue;
    rmSync(resolve(DST, name), { recursive: true });
    purged++;
  }
  const purgedNote = purged > 0 ? `, ${purged} stray file(s) purged` : '';
  console.log(`dust sync: ${copied} copied, ${skipped} up-to-date${purgedNote}`);
}

main();

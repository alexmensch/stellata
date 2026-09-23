/**
 * Fails when any file in the built dist/ exceeds the Cloudflare Workers per-asset limit.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { REPO_ROOT } from '../util/paths';
import {
  ASSET_WARN_FRACTION,
  WORKERS_MAX_ASSET_BYTES,
  formatMiB,
  judgeAssetSizes,
  type AssetSize,
} from './asset-size-pure';

const DIST = resolve(REPO_ROOT, 'dist');
const LARGEST_SHOWN = 5;

function walk(dir: string): AssetSize[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return [{ path: relative(DIST, full), bytes: statSync(full).size }];
  });
}

if (!existsSync(DIST)) {
  console.error(`No ${DIST} to check. Run \`pnpm run build\` first.`);
  process.exit(1);
}

const assets = walk(DIST);
const { largestFirst, oversize, nearLimit } = judgeAssetSizes(assets);
const limit = formatMiB(WORKERS_MAX_ASSET_BYTES);

console.log(`${assets.length} assets in dist/; largest:`);
for (const a of largestFirst.slice(0, LARGEST_SHOWN)) {
  console.log(`  ${formatMiB(a.bytes).padStart(10)}  ${a.path}`);
}

for (const a of nearLimit) {
  console.log(
    `::warning file=dist/${a.path}::${a.path} is ${formatMiB(a.bytes)}, over `
      + `${ASSET_WARN_FRACTION * 100}% of the ${limit} Workers per-asset limit`,
  );
}

if (oversize.length > 0) {
  for (const a of oversize) {
    console.log(
      `::error file=dist/${a.path}::${a.path} is ${formatMiB(a.bytes)}; Cloudflare Workers `
        + `rejects any static asset over ${limit}, so the deploy would fail`,
    );
  }
  process.exit(1);
}

console.log(`All assets within the ${limit} Workers per-asset limit.`);

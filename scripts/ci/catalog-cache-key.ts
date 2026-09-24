// Prints the cache key for CI's catalogue build stage; `--paths` prints the keyed files instead.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { build } from 'esbuild';

import { REPO_ROOT } from '../util/paths';
import { catalogCacheKey, keyedPaths, parseLsFilesStage, tsxEntry } from './catalog-cache-key-pure';

const args = process.argv.slice(2);
const printPaths = args.includes('--paths');
const scriptNames = args.filter((a) => a !== '--paths');
if (scriptNames.length === 0) {
  console.error('usage: catalog-cache-key.ts [--paths] <package.json script>...');
  process.exit(1);
}

const { scripts } = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf-8'));
const { metafile } = await build({
  entryPoints: scriptNames.map((name) => tsxEntry(scripts, name)),
  absWorkingDir: REPO_ROOT,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  metafile: true,
  write: false,
  outdir: 'unwritten',
  logLevel: 'silent',
});

const index = parseLsFilesStage(execFileSync('git', ['ls-files', '-s', '-z'], { cwd: REPO_ROOT, encoding: 'utf-8' }));
const paths = keyedPaths(new Set(Object.keys(metafile.inputs)), index);
console.log(printPaths ? paths.join('\n') : catalogCacheKey(index, paths, process.version));

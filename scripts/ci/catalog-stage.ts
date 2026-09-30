// CI's catalogue build stage: `key` prints its cache key, `paths` the keyed files, `run` builds and diff-gates it.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { scriptClosure } from '../util/import-closure';
import { REPO_ROOT } from '../util/paths';
import {
  type BlobIndex,
  CATALOG_STAGE,
  catalogCacheKey,
  keyedPaths,
  PACKAGE_JSON,
  parseLsFilesStage,
  withVersionlessPackageJson,
} from './catalog-stage-pure';

async function stageKeyInputs(): Promise<{ index: BlobIndex; paths: string[] }> {
  const closure = await scriptClosure(CATALOG_STAGE.map((step) => step.script));
  const index = withVersionlessPackageJson(
    parseLsFilesStage(execFileSync('git', ['ls-files', '-s', '-z'], { cwd: REPO_ROOT, encoding: 'utf-8' })),
    readFileSync(resolve(REPO_ROOT, PACKAGE_JSON), 'utf-8'),
  );
  return { index, paths: keyedPaths(closure, index) };
}

function runStage(): void {
  for (const { script, pinned } of CATALOG_STAGE) {
    console.log(`::group::pnpm run ${script}`);
    execFileSync('pnpm', ['run', script], { cwd: REPO_ROOT, stdio: 'inherit' });
    console.log('::endgroup::');
    const diff = spawnSync('git', ['diff', '--exit-code', '--', ...pinned], { cwd: REPO_ROOT, stdio: 'inherit' });
    if (diff.status !== 0) {
      console.log(`::error::committed outputs of ${script} are stale — run 'pnpm run ${script}' and commit the regenerated files`);
      process.exit(1);
    }
  }
}

const command = process.argv[2];
if (command === 'run') {
  runStage();
} else if (command === 'key' || command === 'paths') {
  const { index, paths } = await stageKeyInputs();
  console.log(command === 'paths' ? paths.join('\n') : catalogCacheKey(index, paths, process.version));
} else {
  console.error('usage: catalog-stage.ts key | paths | run');
  process.exit(1);
}

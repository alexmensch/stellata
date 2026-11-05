// Prints, NUL-separated, the untracked build files CI saves as its data build. See README.md#the-data-build-cache.

import { execFileSync } from 'node:child_process';

import { REPO_ROOT } from '../util/paths';
import { buildFiles } from '../pipeline/build-files';
import { pipelineTree } from '../pipeline/pipeline-tree';
import { loadedRepoTable } from '../pipeline/step-table/repo-table';

const tracked = new Set(execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\0'));
const { steps } = await loadedRepoTable();
process.stdout.write(buildFiles(steps.values(), pipelineTree(REPO_ROOT)).filter((p) => !tracked.has(p)).map((p) => `${p}\0`).join(''));

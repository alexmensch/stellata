// The Node major this process runs under, and the one `.nvmrc` pins for CI. See README.md.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { nodeMajor, type NodeRuntime } from './heap-budget-pure';
import { REPO_ROOT } from '../paths';

export function nodeRuntime(): NodeRuntime {
  return {
    running: nodeMajor(process.version, 'process.version'),
    pinned: nodeMajor(readFileSync(resolve(REPO_ROOT, '.nvmrc'), 'utf8'), '.nvmrc'),
  };
}

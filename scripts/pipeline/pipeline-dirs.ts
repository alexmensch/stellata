// Where the runner keeps its records under a root. See README.md#the-runner--runts.

import { resolve } from 'node:path';

export interface PipelineDirs {
  readonly buildStamps: string;
  readonly manualStamps: string;
  readonly locks: string;
  readonly records: string;
}

export function pipelineDirs(root: string): PipelineDirs {
  return {
    buildStamps: resolve(root, 'build/stamps'),
    manualStamps: resolve(root, 'data/stamps'),
    locks: resolve(root, 'build/locks'),
    records: resolve(root, 'build/records'),
  };
}

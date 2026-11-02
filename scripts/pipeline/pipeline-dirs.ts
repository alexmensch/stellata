// Where the runner keeps its records under a root. See README.md#the-runner--runts.

import { resolve } from 'node:path';

import { stampPath, stepFileName } from '../util/build-stamp';

export interface PipelineDirs {
  readonly buildStamp: (step: string) => string;
  readonly manualStamp: (step: string) => string;
  readonly record: (step: string) => string;
  readonly locks: string;
}

export function pipelineDirs(root: string): PipelineDirs {
  const perStep = (folder: string) => (step: string): string => resolve(root, folder, `${stepFileName(step)}.json`);
  return {
    buildStamp: (step) => stampPath(step, root),
    manualStamp: perStep('data/stamps'),
    record: perStep('build/records'),
    locks: resolve(root, 'build/locks'),
  };
}

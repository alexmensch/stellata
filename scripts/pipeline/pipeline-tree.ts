// The tree a run reads and writes: every table path, stamp key and runner record resolved against one root. See README.md#files.

import { relative, resolve } from 'node:path';

import { MANUAL_STAMP_FOLDER } from '../../src/catalog-format/pipeline-outputs/data-files';
import { STAMP_FOLDER, stampPath, stepFileName } from '../util/stamp-path-pure';

export interface PipelineTree {
  readonly root: string;
  readonly abs: (path: string) => string;
  readonly rel: (path: string) => string;
  readonly rekey: <V>(byPath: Readonly<Record<string, V>>) => Record<string, V>;
  readonly buildStamp: (step: string) => string;
  readonly buildStamps: string;
  readonly manualStamp: (step: string) => string;
  readonly manualStamps: string;
  readonly record: (step: string) => string;
  readonly handedInputs: (step: string) => string;
  readonly answeredBy: (step: string) => string;
  readonly locks: string;
}

export function pipelineTree(root: string): PipelineTree {
  const perStep = (folder: string) => (step: string): string => resolve(root, folder, `${stepFileName(step)}.json`);
  const rel = (path: string): string => relative(root, path);
  return {
    root,
    abs: (path) => resolve(root, path),
    rel,
    rekey: (byPath) => Object.fromEntries(Object.entries(byPath).map(([p, v]) => [rel(p), v])),
    buildStamp: (step) => stampPath(step, root),
    buildStamps: resolve(root, STAMP_FOLDER),
    manualStamp: perStep(MANUAL_STAMP_FOLDER),
    manualStamps: resolve(root, MANUAL_STAMP_FOLDER),
    record: perStep('build/records'),
    handedInputs: perStep('build/step-inputs'),
    answeredBy: perStep('build/answered-by'),
    locks: resolve(root, 'build/locks'),
  };
}

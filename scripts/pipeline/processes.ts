// How the runner and record.ts start a step's process: tsx, or Python under the recorder.

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { FileHashes } from '../util/build-stamp';
import { LAUNCHER } from '../util/import-closure-pure';
import { REPO_ROOT } from '../util/paths';
import { STEP_INPUTS_ENV, writeStepInputs } from '../util/step-input-hashes';
import type { PipelineTree } from './pipeline-tree';

export const TSX = resolve(REPO_ROOT, 'node_modules/.bin/tsx');
/** `tsx`'s arguments for a TypeScript entry: through the launcher, which runs its `main`. */
export const launchArgs = (entry: string, args: readonly string[] = []): string[] => [resolve(REPO_ROOT, LAUNCHER), entry, ...args];
const RUN_PYTHON_STEP = resolve(REPO_ROOT, 'scripts/pipeline/run_python_step.py');

export async function exec(command: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<number | null> {
  const child = spawn(command, args, { stdio: 'inherit', env });
  const [code] = await once(child, 'exit') as [number | null];
  return code;
}

/** A TypeScript step under `tsx`, handed `inputs` (`stepInputHashes`); the file goes when it exits. */
export async function runTs(
  tree: PipelineTree, name: string, entry: string, args: readonly string[], inputs: FileHashes, env: NodeJS.ProcessEnv,
): Promise<number | null> {
  const handed = tree.handedInputs(name);
  mkdirSync(dirname(handed), { recursive: true });
  writeStepInputs(handed, inputs);
  try {
    return await exec(TSX, launchArgs(entry, args), { ...env, [STEP_INPUTS_ENV]: handed });
  } finally {
    rmSync(handed, { force: true });
  }
}

/** What `build_stamp.record_run` writes; every path absolute. */
export interface RunRecord {
  readonly reads: Readonly<Record<string, string | null>>;
  readonly listings: Readonly<Record<string, readonly string[]>>;
  readonly probes: Readonly<Record<string, boolean>>;
  readonly services: readonly string[];
  readonly writes: readonly string[];
}

export type RecordedRun =
  | { readonly kind: 'exited'; readonly code: number | null }
  | { readonly kind: 'ran'; readonly run: RunRecord };

/** A Python manual step run under `build_stamp.record_run`; its record is read only when it exits 0. */
export async function runRecorded(
  tree: PipelineTree, name: string, entry: string, args: readonly string[], env: NodeJS.ProcessEnv,
): Promise<RecordedRun> {
  const record = tree.record(name);
  const code = await exec('python3', [RUN_PYTHON_STEP, tree.root, record, entry, ...args], env);
  if (code !== 0) return { kind: 'exited', code };
  return { kind: 'ran', run: JSON.parse(readFileSync(record, 'utf8')) as RunRecord };
}

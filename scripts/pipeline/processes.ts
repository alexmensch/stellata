// How the runner and record.ts start a step's process: tsx, or Python under the recorder.

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT } from '../util/paths';
import type { PipelineTree } from './pipeline-tree';
import type { RunRecord } from './python-run-pure';

export const TSX = resolve(REPO_ROOT, 'node_modules/.bin/tsx');
const RUN_PYTHON_STEP = resolve(REPO_ROOT, 'scripts/pipeline/run_python_step.py');

export async function exec(command: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<number | null> {
  const child = spawn(command, args, { stdio: 'inherit', env });
  const [code] = await once(child, 'exit') as [number | null];
  return code;
}

export type RecordedRun =
  | { readonly kind: 'exited'; readonly code: number | null }
  | { readonly kind: 'ran'; readonly run: RunRecord };

/** A Python step run under `build_stamp.record_run`; its record is read only when it exits 0. */
export async function runRecorded(
  tree: PipelineTree, name: string, entry: string, args: readonly string[], env: NodeJS.ProcessEnv,
): Promise<RecordedRun> {
  const record = tree.record(name);
  const code = await exec('python3', [RUN_PYTHON_STEP, tree.root, record, entry, ...args], env);
  if (code !== 0) return { kind: 'exited', code };
  return { kind: 'ran', run: JSON.parse(readFileSync(record, 'utf8')) as RunRecord };
}

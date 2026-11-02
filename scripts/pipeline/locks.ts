// A step's locks, held by a lock_holder.py child for as long as the step runs. See README.md#the-runner--runts.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { stepFileName } from '../util/stamp-path-pure';
import { REPO_ROOT } from '../util/paths';
import { isBuild, writersOf, type ResolvedStep, type StepGraph } from './step-table-pure';

const HOLDER = resolve(REPO_ROOT, 'scripts/pipeline/lock_holder.py');
const WAIT_NOTICE_MS = 1000;

/** A running step holds its own lock exclusive; a checked manual step holds
 *  only the shared ones. */
export interface StepLocks {
  readonly step: string;
  readonly exclusive: boolean;
  readonly shared: readonly string[];
}

/** Every lock in step-name order, so two runs inside a loop cannot each hold
 *  one the other wants. */
export function lockSpecs({ step, exclusive, shared }: StepLocks): string[] {
  const names = [...new Set(exclusive ? [step, ...shared] : shared)].sort();
  return names.map((n) => `${exclusive && n === step ? 'ex' : 'sh'}:${stepFileName(n)}`);
}

export interface HeldLocks {
  readonly pid: number;
  /** True once the holder exited before `release`: the kernel dropped its locks. */
  readonly died: () => boolean;
  readonly release: () => Promise<void>;
}

export async function holdLocks(lockDir: string, locks: StepLocks, onWait: () => void): Promise<HeldLocks> {
  const child = spawn('python3', [HOLDER, lockDir, ...lockSpecs(locks)], { stdio: ['pipe', 'pipe', 'inherit'] });
  child.stdin.on('error', () => {});
  const exited = new Promise<void>((done) => { child.once('exit', () => done()); });
  const notice = setTimeout(onWait, WAIT_NOTICE_MS);
  try {
    await new Promise<void>((done, fail) => {
      let out = '';
      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString();
        if (out.includes('locked\n')) done();
      });
      void exited.then(() => fail(new Error(`lock holder for ${locks.step} exited before locking`)));
      child.once('error', fail);
    });
  } finally {
    clearTimeout(notice);
  }
  let releasing = false;
  let diedEarly = false;
  void exited.then(() => { if (!releasing) diedEarly = true; });
  return {
    pid: child.pid!,
    died: () => diedEarly,
    release: async () => {
      releasing = true;
      child.stdin.end();
      await exited;
    },
  };
}

export function holdStepLocks(
  lockDir: string,
  table: { readonly graph: StepGraph; readonly steps: ReadonlyMap<string, ResolvedStep> },
  name: string,
  exclusive: boolean,
  log: (line: string) => void,
): Promise<HeldLocks> {
  const shared = writersOf(table.graph, name).filter((w) => isBuild(table.steps.get(w)!.step));
  return holdLocks(lockDir, { step: name, exclusive, shared }, () => log(`… ${name} waits for another run's lock`));
}

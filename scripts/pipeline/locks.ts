// A step's locks, held by a lock_holder.py child for as long as the step runs. See README.md#the-runner--runts.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { stepFileName } from '../util/build-stamp';
import { REPO_ROOT } from '../util/paths';

const HOLDER = resolve(REPO_ROOT, 'scripts/pipeline/lock_holder.py');
const WAIT_NOTICE_MS = 1000;

export interface StepLocks {
  readonly own: string;
  readonly shared: readonly string[];
}

/** Every lock in step-name order, so two runs inside a loop cannot each hold
 *  one the other wants. */
export function lockSpecs({ own, shared }: StepLocks): string[] {
  const names = [...new Set([own, ...shared])].sort();
  return names.map((n) => `${n === own ? 'ex' : 'sh'}:${stepFileName(n)}`);
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
      void exited.then(() => fail(new Error(`lock holder for ${locks.own} exited before locking`)));
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

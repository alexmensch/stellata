// Throwaway-repo helpers for tests that drive a script over real git history.

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function gitIn(repo: string): (...args: string[]) => SpawnSyncReturns<string> {
  return (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf-8' });
}

export function commitFile(repo: string, path: string, content = 'x'): void {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  const git = gitIn(repo);
  git('add', path);
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', path);
}

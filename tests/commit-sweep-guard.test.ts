// Behavioural guard for scripts/hooks/commit-sweep-guard.sh: the commit-time
// README sweep must fire on a stale folder README and must honour the
// readme-skip opt-out however the commit message reached git.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HOOK = resolve(__dirname, '../scripts/hooks/commit-sweep-guard.sh');

const SKIP_REASON = '[readme-skip: every claim in it still holds]';

let repo: string;

function git(...args: string[]): void {
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd: repo,
    stdio: 'ignore',
  });
}

function write(rel: string, body = 'placeholder\n'): void {
  const full = join(repo, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

function allowed(command: string): boolean {
  const stdout = execFileSync('bash', [HOOK], {
    cwd: repo,
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf-8',
  });
  if (stdout.trim() === '') return true;
  const parsed = JSON.parse(stdout) as {
    hookSpecificOutput: { permissionDecision: string };
  };
  return parsed.hookSpecificOutput.permissionDecision !== 'deny';
}

/** A staged change under a guarded folder whose README is NOT in the commit
 *  — the state the sweep exists to catch. */
function stageStaleChange(): void {
  write('src/thing/README.md', '# thing\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'seed');
  write('src/thing/thing.ts', 'export const x = 1;\n');
  git('add', '-A');
}

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'commit-sweep-repo-')));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'guard@example.test');
  git('config', 'user.name', 'Guard');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('commit-sweep-guard', () => {
  it('lets a non-commit Bash call straight through', () => {
    stageStaleChange();
    expect(allowed('git status -sb')).toBe(true);
  });

  it('denies a commit that leaves its folder README stale', () => {
    stageStaleChange();
    expect(allowed('git commit -m "add a thing"')).toBe(false);
  });

  it('honours the skip tag in an inline -m message', () => {
    stageStaleChange();
    expect(allowed(`git commit -m "add a thing ${SKIP_REASON}"`)).toBe(true);
  });

  // The regression this file was added for. A worktree-isolated session
  // cannot pass a long message any other way: the worktree guard rejects
  // `$( )` substitution and heredoc bodies, so -F is the only route left
  // and the tag lives where only the file can carry it.
  it('honours the skip tag inside a -F message file', () => {
    stageStaleChange();
    const msg = join(repo, 'msg.txt');
    writeFileSync(msg, `add a thing\n\n${SKIP_REASON}\n`);
    expect(allowed(`git commit -F ${msg}`)).toBe(true);
  });

  it('honours it for --file= and a -F file whose reason wraps lines', () => {
    stageStaleChange();
    const msg = join(repo, 'msg.txt');
    writeFileSync(msg, '[readme-skip: the reason\nwraps across lines]\n');
    expect(allowed(`git commit --file=${msg}`)).toBe(true);
  });

  it('still denies when the -F file carries no tag', () => {
    stageStaleChange();
    const msg = join(repo, 'msg.txt');
    writeFileSync(msg, 'add a thing, no opt-out here\n');
    expect(allowed(`git commit -F ${msg}`)).toBe(false);
  });

  it('does not fall over when the -F file does not exist', () => {
    stageStaleChange();
    expect(allowed(`git commit -F ${join(repo, 'absent.txt')}`)).toBe(false);
  });
});

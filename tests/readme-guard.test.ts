// Behavioural guard for scripts/hooks/readme-guard.sh: the scout-pass gate
// must fire for every folder that carries prior context, and stay silent for
// a folder whose README has never existed.

import { execFileSync } from 'node:child_process';
import {
  mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HOOK = resolve(__dirname, '../scripts/hooks/readme-guard.sh');

let repo: string;
let stateDir: string;

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

interface Decision {
  allowed: boolean;
  reason: string;
}

function hook(tool: string, rel: string): Decision {
  const stdout = execFileSync('bash', [HOOK], {
    cwd: repo,
    input: JSON.stringify({ tool_name: tool, tool_input: { file_path: join(repo, rel) } }),
    env: { ...process.env, TMPDIR: stateDir },
    encoding: 'utf-8',
  });
  if (stdout.trim() === '') return { allowed: true, reason: '' };
  const parsed = JSON.parse(stdout) as {
    hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
  };
  return {
    allowed: parsed.hookSpecificOutput.permissionDecision !== 'deny',
    reason: parsed.hookSpecificOutput.permissionDecisionReason,
  };
}

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'readme-guard-repo-')));
  stateDir = realpathSync(mkdtempSync(join(tmpdir(), 'readme-guard-state-')));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'guard@example.test');
  git('config', 'user.name', 'guard test');
  write('src/client/README.md', '# client\n');
  write('src/client/thing.ts');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

describe('readme-guard', () => {
  it('gates a source file whose folder README is unread', () => {
    const decision = hook('Write', 'src/client/thing.ts');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('src/client/README.md');
  });

  it('opens the folder once its README is Read', () => {
    expect(hook('Read', 'src/client/README.md').allowed).toBe(true);
    expect(hook('Write', 'src/client/thing.ts').allowed).toBe(true);
  });

  it('ignores files outside the guarded prefixes', () => {
    write('tests/thing.test.ts');
    expect(hook('Write', 'tests/thing.test.ts').allowed).toBe(true);
  });

  it('allows the first write into a folder that does not exist yet', () => {
    expect(hook('Write', 'src/client/newthing/thing.ts').allowed).toBe(true);
  });

  it('allows the whole new-folder authoring sequence', () => {
    expect(hook('Write', 'src/client/newthing/README.md').allowed).toBe(true);
    write('src/client/newthing/README.md', '# newthing\n');
    expect(hook('Write', 'src/client/newthing/thing.ts').allowed).toBe(true);
    write('src/client/newthing/thing.ts');
    expect(hook('Edit', 'src/client/newthing/README.md').allowed).toBe(true);
    expect(hook('Edit', 'src/client/newthing/thing.ts').allowed).toBe(true);
  });

  it('allows source-first authoring in a new folder, README written last', () => {
    expect(hook('Write', 'src/client/newthing/thing.ts').allowed).toBe(true);
    write('src/client/newthing/thing.ts');
    expect(hook('Write', 'src/client/newthing/other.ts').allowed).toBe(true);
    write('src/client/newthing/other.ts');
    expect(hook('Write', 'src/client/newthing/README.md').allowed).toBe(true);
    write('src/client/newthing/README.md', '# newthing\n');
    expect(hook('Edit', 'src/client/newthing/thing.ts').allowed).toBe(true);
  });

  it('still gates an untracked folder whose README already exists unread', () => {
    write('src/client/handoff/README.md', '# handoff\n');
    write('src/client/handoff/thing.ts');
    const decision = hook('Edit', 'src/client/handoff/thing.ts');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('src/client/handoff/README.md');
  });

  it('still charges the ancestor README for a tracked folder missing one', () => {
    write('src/client/legacy/thing.ts');
    git('add', '-A');
    git('commit', '-qm', 'legacy folder without a README');
    const decision = hook('Write', 'src/client/legacy/other.ts');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('src/client/README.md');
  });

  it('gates a path reached through a symlink to the checkout', () => {
    // `git rev-parse --show-toplevel` reports a realpath, so an unresolved
    // `$abs` failed every guarded-prefix test and the hook exited silent.
    // macOS `/tmp` is such a symlink, which is where this was found.
    const link = join(stateDir, 'link');
    symlinkSync(repo, link);
    const stdout = execFileSync('bash', [HOOK], {
      cwd: repo,
      input: JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: join(link, 'src/client/thing.ts') },
      }),
      env: { ...process.env, TMPDIR: stateDir },
      encoding: 'utf-8',
    });
    expect(stdout).toContain('src/client/README.md');
  });
});

// Behavioural test for scripts/hooks/paper-store-link.sh over a throwaway repo
// with real linked worktrees.

import { execFileSync } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HOOK = resolve(__dirname, '../scripts/hooks/paper-store-link.sh');
const LINK = 'data/papers/pdf';

let root: string;
let main: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

function run(projectDir = main): void {
  execFileSync('bash', [HOOK], {
    input: JSON.stringify({ hook_event_name: 'SessionStart' }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  });
}

function addWorktree(name: string): string {
  const wt = join(root, name);
  git(main, 'worktree', 'add', '-q', '-b', name, wt);
  return wt;
}

const linkOf = (checkout: string) => readlinkSync(join(checkout, LINK));

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'paper-store-link-')));
  main = join(root, 'main');
  mkdirSync(join(main, 'data/papers'), { recursive: true });
  writeFileSync(join(main, 'data/papers/README.md'), '# papers\n');
  writeFileSync(join(main, '.gitignore'), `${LINK}\n`);
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '.');
  git(main, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'init');
  mkdirSync(join(root, 'store-a'));
  mkdirSync(join(root, 'store-b'));
  symlinkSync(join(root, 'store-a'), join(main, LINK));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('paper-store-link', () => {
  it('copies the main checkout\'s link into a worktree that lacks it', () => {
    const wt = addWorktree('wt1');
    expect(existsSync(join(wt, LINK))).toBe(false);
    run();
    expect(lstatSync(join(wt, LINK)).isSymbolicLink()).toBe(true);
    expect(linkOf(wt)).toBe(linkOf(main));
  });

  it('reaches every worktree whichever checkout it runs from', () => {
    const a = addWorktree('wt1');
    const b = addWorktree('wt2');
    run(a);
    expect(linkOf(a)).toBe(linkOf(main));
    expect(linkOf(b)).toBe(linkOf(main));
  });

  it('follows main when the store moves', () => {
    const wt = addWorktree('wt1');
    run();
    rmSync(join(main, LINK));
    symlinkSync(join(root, 'store-b'), join(main, LINK));
    run();
    expect(linkOf(wt)).toBe(join(root, 'store-b'));
  });

  it('never replaces a real folder in a worktree', () => {
    const wt = addWorktree('wt1');
    mkdirSync(join(wt, LINK));
    run();
    expect(lstatSync(join(wt, LINK)).isDirectory()).toBe(true);
  });

  it('does nothing when the main checkout has no link', () => {
    rmSync(join(main, LINK));
    const wt = addWorktree('wt1');
    run();
    expect(existsSync(join(wt, LINK))).toBe(false);
  });

  it('exits cleanly outside a git repository', () => {
    expect(() => run(root)).not.toThrow();
  });
});

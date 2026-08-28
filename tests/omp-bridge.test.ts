// Drives scripts/hooks/omp-bridge.ts against a real temp git repo with real
// worktrees, real branches and the real .sh guards — the half a stubbed
// extractor test cannot reach.

import { execFileSync } from 'node:child_process';
import {
  chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ompBridge from '../scripts/hooks/omp-bridge';

type Block = { block: true; reason: string } | undefined;
type ToolCall = (
  event: { toolName: string; input: Record<string, unknown> },
  ctx: { cwd: string; sessionManager: { getSessionId(): string } },
) => Promise<Block>;
type Lifecycle = (
  event: unknown,
  ctx: { cwd: string; sessionManager: { getSessionId(): string } },
) => Promise<void>;

/** Every event id the bridge subscribed to, so a stray one is visible. */
let subscribed: string[];

let main: string;
let feature: string;
let state: string;
let sessions = 0;
let sessionId: string;
let handlers: { toolCall?: ToolCall };
let originalTmp: string | undefined;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf-8',
  }).trim();
}

function write(root: string, rel: string, body = 'placeholder\n'): string {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
  return full;
}

function register(): void {
  handlers = {};
  subscribed = [];
  ompBridge({
    on(event: string, handler: ToolCall | Lifecycle) {
      subscribed.push(event);
      if (event === 'tool_call') handlers.toolCall = handler as ToolCall;
    },
    logger: { warn() {} },
  } as never);
}

async function call(
  toolName: string,
  input: Record<string, unknown>,
  cwd = feature,
): Promise<Block> {
  return handlers.toolCall?.(
    { toolName, input },
    { cwd, sessionManager: { getSessionId: () => sessionId } },
  );
}


beforeEach(() => {
  main = realpathSync(mkdtempSync(join(tmpdir(), 'omp-bridge-main-')));
  state = realpathSync(mkdtempSync(join(tmpdir(), 'omp-bridge-state-')));
  sessionId = `session-${++sessions}`;

  git(main, 'init', '-q', '-b', 'main');
  git(main, 'config', 'user.email', 'guard@example.test');
  git(main, 'config', 'user.name', 'Guard');
  write(main, 'src/thing/README.md', '# thing\n');
  write(main, 'src/thing/thing.ts', 'export const x = 1;\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-qm', 'init');

  feature = join(main, '.claude/worktrees/wt');
  git(main, 'worktree', 'add', '-q', '-b', 'worktree-wt', feature);


  originalTmp = process.env.TMPDIR;
  process.env.TMPDIR = state;
  register();
});

afterEach(() => {
  if (originalTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmp;
  git(main, 'worktree', 'remove', '--force', feature);
  rmSync(main, { recursive: true, force: true });
  rmSync(state, { recursive: true, force: true });
});

describe('prime context', () => {
  it('gates nothing — the bd context is an always-apply rule, not a sentinel', () => {
    // Claude Code needs prime-guard because its SessionStart payload is
    // truncated to 2KB. omp injects .omp/rules/bd-prime.md into the system
    // prompt, which compaction rebuilds, so there is nothing to re-arm.
    expect(subscribed).toEqual(['tool_call']);
  });

  it('lets the first call of a session straight through', async () => {
    expect(await call('todo', { action: 'list' })).toBeUndefined();
  });
});

describe('trunk rule', () => {

  it('blocks a commit and every push spelling on main', async () => {
    for (const command of [
      'git commit -m x',
      'git push',
      'git push -f',
      'git push origin HEAD',
      'git push; echo done',
      '{ git push; }',
    ]) {
      const verdict = await call('bash', { command }, main);
      expect(verdict?.reason, command).toMatch(/Refusing to (commit|push) on main/);
    }
  });

  it('blocks a refspec push to trunk from a feature branch', async () => {
    // The local branch is `worktree-wt`, so only the destination reveals it.
    for (const command of [
      'git push origin HEAD:main',
      'git push origin worktree-wt:refs/heads/main',
      'git push origin +master',
      'git push --delete origin main',
    ]) {
      const verdict = await call('bash', { command });
      expect(verdict?.reason, command).toMatch(/refspec names a protected branch/);
    }
  });

  it('allows a refspec push to an ordinary branch', async () => {
    expect(await call('bash', { command: 'git push origin HEAD:worktree-wt' }))
      .toBeUndefined();
  });

  it('blocks a push behind a cd that is not the first word', async () => {
    const verdict = await call('bash', { command: `true && cd ${main} && git push` });
    expect(verdict?.reason).toMatch(/Refusing to push on main/);
  });

  it('blocks a push inside a subshell that cds into main', async () => {
    const verdict = await call('bash', { command: `(cd ${main}; git push)` });
    expect(verdict?.reason).toMatch(/Refusing to push on main/);
  });

  it('blocks git -C <main> push issued from a feature worktree', async () => {
    const verdict = await call('bash', { command: `git -C ${main} push` });
    expect(verdict?.reason).toMatch(/Refusing to push on main/);
  });

  it('blocks a push whose directory comes from the bash cwd field', async () => {
    const verdict = await call('bash', { command: 'git push', cwd: main });
    expect(verdict?.reason).toMatch(/Refusing to push on main/);
  });

  it('blocks a push behind a leading cd', async () => {
    const verdict = await call('bash', { command: `cd ${main} && git push` });
    expect(verdict?.reason).toMatch(/Refusing to push on main/);
  });

  it('blocks a detached HEAD rather than reading it as "not main"', async () => {
    git(main, 'checkout', '-q', '--detach');
    const verdict = await call('bash', { command: 'git push' }, main);
    expect(verdict?.reason).toMatch(/HEAD names no branch/);
  });

  it('allows a commit and a push on a feature branch', async () => {
    expect(await call('bash', { command: 'git push' })).toBeUndefined();
  });

  it('allows read-only git on main', async () => {
    for (const command of ['git status', 'git log --oneline', 'git diff']) {
      expect(await call('bash', { command }, main), command).toBeUndefined();
    }
  });

  it('allows a commit outside any repository', async () => {
    expect(await call('bash', { command: 'git push' }, state)).toBeUndefined();
  });
});

describe('github pr_push', () => {

  it('blocks when the recorded PR head ref is protected', async () => {
    git(feature, 'config', 'branch.worktree-wt.ompPrHeadRef', 'main');
    const verdict = await call('github', { op: 'pr_push' });
    expect(verdict?.reason).toMatch(/would write main/);
  });

  it('blocks when the named branch is itself protected', async () => {
    const verdict = await call('github', { op: 'pr_push', branch: 'master' });
    expect(verdict?.reason).toMatch(/would write master/);
  });

  it('allows a push to an ordinary PR head ref', async () => {
    git(feature, 'config', 'branch.worktree-wt.ompPrHeadRef', 'feature-x');
    expect(await call('github', { op: 'pr_push' })).toBeUndefined();
  });

  it('ignores every other github op', async () => {
    expect(await call('github', { op: 'pr_create', title: 'x' })).toBeUndefined();
  });
});

describe('main-worktree rule', () => {
  beforeEach(async () => {
    await call('read', { path: join(main, 'src/thing/README.md') });
  });

  it('blocks a write, an edit, an ast_edit and an lsp rename into it', async () => {
    const target = join(main, 'src/thing/thing.ts');
    const calls: Array<[string, Record<string, unknown>]> = [
      ['write', { path: target, content: 'x' }],
      ['edit', { input: `[${target}#1A2B]\nPUT 1.=1:\n+x` }],
      ['ast_edit', { paths: [target], ops: [{ pat: 'a', out: 'b' }] }],
      ['lsp', { action: 'rename', file: target, new_name: 'y' }],
    ];
    for (const [tool, input] of calls) {
      const verdict = await call(tool, input);
      expect(verdict?.reason, tool).toMatch(/in the main worktree/);
    }
  });

  it('allows lsp references in the main worktree', async () => {
    const verdict = await call('lsp', {
      action: 'references',
      file: join(main, 'src/thing/thing.ts'),
    });
    expect(verdict).toBeUndefined();
  });

  it('allows the same write inside a secondary worktree', async () => {
    await call('read', { path: join(feature, 'src/thing/README.md') });
    const verdict = await call('write', {
      path: join(feature, 'src/thing/thing.ts'),
      content: 'x',
    });
    expect(verdict).toBeUndefined();
  });

  it('blocks a tilde path, which resolves against $HOME and not the session cwd', async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = dirname(main);
    try {
      const verdict = await call('edit', {
        input: `[~/${basename(main)}/src/thing/thing.ts#1A2B]\nPUT 1.=1:\n+x`,
      });
      expect(verdict?.reason).toMatch(/in the main worktree/);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });

  it('blocks an in-place sed into the main worktree', async () => {
    const verdict = await call('bash', {
      command: `sed -i '' 's/a/b/' ${join(main, 'src/thing/thing.ts')}`,
    });
    expect(verdict?.reason).toMatch(/in the main worktree/);
  });

  it('blocks a redirect into the main worktree', async () => {
    const verdict = await call('bash', {
      command: `echo hi > ${join(main, 'src/thing/thing.ts')}`,
    });
    expect(verdict?.reason).toMatch(/in the main worktree/);
  });

  it('allows a redirect inside a secondary worktree', async () => {
    const verdict = await call('bash', {
      command: `echo hi > ${join(feature, 'src/thing/thing.ts')}`,
    });
    expect(verdict).toBeUndefined();
  });
});

describe('scout pass', () => {

  it('blocks a read into a folder whose README is unread, then allows it', async () => {
    const target = join(feature, 'src/thing/thing.ts');
    const blocked = await call('read', { path: target });
    expect(blocked?.reason).toMatch(/Read src\/thing\/README\.md first/);

    await call('read', { path: join(feature, 'src/thing/README.md') });
    expect(await call('read', { path: target })).toBeUndefined();
  });

  it('does not mark a folder scouted when the README is written unread', async () => {
    const readme = join(feature, 'src/thing/README.md');
    await call('write', { path: readme, content: '# thing\n' });
    const verdict = await call('read', { path: join(feature, 'src/thing/thing.ts') });
    expect(verdict?.reason).toMatch(/Read src\/thing\/README\.md first/);
  });
});

describe('unclassified tools', () => {

  it('blocks a tool the bridge has never heard of', async () => {
    const verdict = await call('teleport', { path: 'src/thing/thing.ts' });
    expect(verdict?.reason).toMatch(/cannot tell which files the call touches/);
    expect(verdict?.reason).toMatch(/KNOWN_TOOLS/);
  });

  it('blocks an edit that names no file', async () => {
    const verdict = await call('edit', { input: 'PUT 1.=1:\n+x' });
    expect(verdict?.reason).toMatch(/cannot tell which files the call touches/);
  });
});

describe('guard failure', () => {
  it('throws when a guard cannot be spawned, so omp fails the call closed', async () => {
    const guard = join(__dirname, '../scripts/hooks/readme-guard.sh');
    const mode = statSync(guard).mode;
    chmodSync(guard, 0o000);
    try {
      await expect(
        call('read', { path: join(feature, 'src/thing/thing.ts') }),
      ).rejects.toThrow(/cannot run .*readme-guard\.sh/);
    } finally {
      chmodSync(guard, mode);
    }
  });
});

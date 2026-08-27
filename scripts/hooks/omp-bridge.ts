// omp extension that runs the Claude Code guard scripts in this folder, and
// natively enforces the two rules no .sh guard covers under omp: edits belong
// in a secondary worktree, and main/master takes no commit or push.

import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  buildPayload,
  gitHistoryOp,
  isProtectedBranch,
  needsCommitSweep,
  parseVerdict,
  toolTargets,
} from './omp-bridge-pure';

const HOOK_DIR = dirname(new URL(import.meta.url).pathname);
const README_GUARD = join(HOOK_DIR, 'readme-guard.sh');
const COMMIT_SWEEP_GUARD = join(HOOK_DIR, 'commit-sweep-guard.sh');

interface ToolCallEvent {
  toolName: string;
  input: Record<string, unknown>;
}

interface BridgeContext {
  cwd: string;
  sessionManager: { getSessionId(): string };
}

interface BridgeApi {
  on(
    event: 'tool_call',
    handler: (
      event: ToolCallEvent,
      ctx: BridgeContext,
    ) => Promise<{ block: true; reason: string } | undefined>,
  ): void;
  on(
    event: 'session_start',
    handler: (event: unknown, ctx: BridgeContext) => Promise<void>,
  ): void;
  sendMessage(
    message: {
      customType: string;
      content: string;
      display: boolean;
      attribution: 'agent';
    },
    options: { deliverAs: 'nextTurn' },
  ): void;
  logger: { warn(message: string): void };
}

function git(cwd: string, args: string[]): string | undefined {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' });
  if (result.status !== 0) return undefined;
  const out = (result.stdout ?? '').trim();
  return out === '' ? undefined : out;
}

/**
 * A guard script missing or unspawnable throws rather than returning "allow":
 * omp fails a throwing tool_call handler closed, so a broken bridge surfaces
 * immediately instead of leaving every tool call silently ungated.
 */
function runGuard(
  script: string,
  payload: unknown,
  cwd: string,
  sessionId: string,
): string | undefined {
  const result = spawnSync(script, {
    input: JSON.stringify(payload),
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, GUARD_SESSION: sessionId },
  });
  if (result.error !== undefined) {
    throw new Error(`omp-bridge: cannot run ${script}: ${result.error.message}`);
  }
  return parseVerdict(result.stdout ?? '');
}

/** Deepest existing ancestor, so a write to a not-yet-created file resolves. */
function existingAncestorDir(path: string): string | undefined {
  let probe = path;
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) return undefined;
    probe = parent;
  }
  return statSync(probe).isDirectory() ? probe : dirname(probe);
}

function mainWorktreeBlock(
  rawPath: string,
  cwd: string,
): string | undefined {
  const probe = existingAncestorDir(
    isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath),
  );
  if (probe === undefined) return undefined;

  const toplevel = git(probe, ['rev-parse', '--show-toplevel']);
  if (toplevel === undefined) return undefined;

  const gitDir = git(toplevel, ['rev-parse', '--absolute-git-dir']);
  const commonRaw = git(toplevel, ['rev-parse', '--git-common-dir']);
  if (gitDir === undefined || commonRaw === undefined) return undefined;

  // A secondary worktree's git-dir is <common>/worktrees/<name>; only the main
  // worktree has the two equal.
  const commonDir = isAbsolute(commonRaw)
    ? commonRaw
    : resolve(toplevel, commonRaw);
  if (gitDir !== commonDir) return undefined;

  return `Refusing to edit ${rawPath} in the main worktree of ${toplevel}.

Code edits belong in a fresh git worktree so parallel sessions sharing this
checkout do not collide on the index lock, clobber each other's edits, or move
the branch under a running dev server.

Fix: create one, then redo the edit against the path inside it.

  git -C ${toplevel} worktree add .claude/worktrees/<name> -b worktree-<name>

Read-only investigation in the main worktree is fine; only edits are blocked.`;
}

/**
 * The branch, not the command text, decides whether a push is allowed — which
 * is why this is a handler and not a `bash.patterns` glob.
 */
function protectedBranchBlock(
  op: 'commit' | 'push',
  cwd: string,
): string | undefined {
  const branch = git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (branch === undefined || !isProtectedBranch(branch)) return undefined;

  return `Refusing to ${op} on ${branch}.

CLAUDE.md § Git workflow: never commit or push to main, and never to a branch
this session did not create. Diff size is never a justification.

Fix: move the work onto a feature branch in its own worktree, then ${op} there.

  git worktree add .claude/worktrees/<name> -b worktree-<name>

If this ${op} is genuinely intended, the operator can run it.`;
}

export default function ompBridge(pi: BridgeApi): void {
  pi.on('session_start', async (_event, ctx) => {
    const prime = spawnSync('bd', ['prime', '--full'], {
      cwd: ctx.cwd,
      encoding: 'utf-8',
    });
    const text = (prime.stdout ?? '').trim();
    if (prime.status !== 0 || text === '') {
      pi.logger.warn('omp-bridge: bd prime produced no context');
      return;
    }
    pi.sendMessage(
      {
        customType: 'stellata.bd-prime',
        content: `Project issue-tracker context for this session:\n\n${text}`,
        display: false,
        attribution: 'agent',
      },
      { deliverAs: 'nextTurn' },
    );
  });

  pi.on('tool_call', async (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const target = toolTargets(event.toolName, event.input);

    for (const path of target.paths) {
      if (target.mutates) {
        const worktree = mainWorktreeBlock(path, ctx.cwd);
        if (worktree !== undefined) return { block: true, reason: worktree };
      }
      const payload = buildPayload({
        tool: target.tool,
        sessionId,
        cwd: ctx.cwd,
        filePath: path,
      });
      if (payload === undefined) continue;
      const reason = runGuard(README_GUARD, payload, ctx.cwd, sessionId);
      if (reason !== undefined) return { block: true, reason };
    }

    if (event.toolName === 'bash') {
      const command =
        typeof event.input.command === 'string' ? event.input.command : '';
      const op = gitHistoryOp(command);
      if (op !== undefined) {
        const branch = protectedBranchBlock(op, ctx.cwd);
        if (branch !== undefined) return { block: true, reason: branch };
      }
      if (needsCommitSweep(command)) {
        const payload = buildPayload({
          tool: 'bash',
          sessionId,
          cwd: ctx.cwd,
          command,
        });
        if (payload !== undefined) {
          const reason = runGuard(
            COMMIT_SWEEP_GUARD,
            payload,
            ctx.cwd,
            sessionId,
          );
          if (reason !== undefined) return { block: true, reason };
        }
      }
    }

    return undefined;
  });
}

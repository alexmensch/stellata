// omp extension that replays the Claude Code guard scripts in this folder and
// natively enforces the two rules no .sh guard covers: edits belong in a
// secondary worktree, and main/master takes no commit or push.

import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bashWriteTargets,
  buildPayload,
  claudeToolName,
  githubPushBranches,
  gitHistoryOps,
  isProtectedBranch,
  needsCommitSweep,
  normalizeToolPath,
  parseVerdict,
  toolTargets,
} from './omp-bridge-pure';

// `URL.pathname` stays percent-encoded, so a checkout path containing a space
// resolved to a directory that does not exist and every guard spawn threw.
const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
const README_GUARD = join(HOOK_DIR, 'readme-guard.sh');
const COMMIT_SWEEP_GUARD = join(HOOK_DIR, 'commit-sweep-guard.sh');
const PRIME_GUARD = join(HOOK_DIR, 'prime-guard.sh');

const ALLOW_UNKNOWN = process.env.STELLATA_OMP_ALLOW_UNKNOWN_TOOLS === '1';

interface ToolCallEvent {
  toolName: string;
  input: Record<string, unknown>;
}

interface BridgeContext {
  cwd: string;
  sessionManager: { getSessionId(): string };
}

type Block = { block: true; reason: string } | undefined;

interface BridgeApi {
  on(
    event: 'tool_call',
    handler: (event: ToolCallEvent, ctx: BridgeContext) => Promise<Block>,
  ): void;
  on(
    event: 'session_compact' | 'session_start',
    handler: (event: unknown, ctx: BridgeContext) => Promise<void>,
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
 * A guard script that cannot be spawned throws: omp fails a throwing tool_call
 * handler closed, so a broken bridge surfaces immediately instead of leaving
 * every tool call silently ungated.
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
    env: {
      ...process.env,
      GUARD_SESSION: sessionId,
      GUARD_NO_READ_BEFORE_WRITE: '1',
    },
  });
  if (result.error !== undefined) {
    throw new Error(`omp-bridge: cannot run ${script}: ${result.error.message}`);
  }
  return parseVerdict({ stdout: result.stdout ?? '', status: result.status });
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

/** `$HOME` first, so a test can point the tilde at a temp tree. */
function home(): string {
  return process.env.HOME ?? homedir();
}

function absolute(rawPath: string, cwd: string): string {
  const path = normalizeToolPath(rawPath, home());
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function mainWorktreeBlock(rawPath: string, cwd: string): string | undefined {
  const probe = existingAncestorDir(absolute(rawPath, cwd));
  if (probe === undefined) return undefined;

  const toplevel = git(probe, ['rev-parse', '--show-toplevel']);
  if (toplevel === undefined) return undefined;

  const gitDir = git(toplevel, ['rev-parse', '--absolute-git-dir']);
  const commonRaw = git(toplevel, ['rev-parse', '--git-common-dir']);
  if (gitDir === undefined || commonRaw === undefined) return undefined;

  // A secondary worktree's git-dir is <common>/worktrees/<name>; only the main
  // worktree has the two equal.
  const commonDir = isAbsolute(commonRaw) ? commonRaw : resolve(toplevel, commonRaw);
  if (gitDir !== commonDir) return undefined;

  return `Refusing to write ${rawPath} in the main worktree of ${toplevel}.

Code edits belong in a fresh git worktree so parallel sessions sharing this
checkout do not collide on the index lock, clobber each other's edits, or move
the branch under a running dev server.

Fix: create one, then redo the edit against the path inside it.

  git -C ${toplevel} worktree add .claude/worktrees/<name> -b worktree-<name>

Read-only investigation in the main worktree is fine; only writes are blocked.`;
}

/**
 * Where HEAD is, not the command text, decides whether a push is allowed —
 * which is why this is a handler and not a `bash.patterns` glob. A repo whose
 * HEAD names no branch is unknown, not safe, so it blocks. `destinations`
 * carries the refspec targets, because `git push origin HEAD:main` writes
 * trunk from a feature branch and the local branch never reveals it.
 */
function protectedBranchBlock(
  op: 'commit' | 'push',
  dir: string,
  destinations: string[],
): string | undefined {
  const remote = destinations.find(isProtectedBranch);
  if (remote !== undefined) {
    return `Refusing to push ${remote}: the refspec names a protected branch.

AGENTS.md § Git workflow protects main and master whatever branch is checked
out locally, so a refspec push to trunk is refused the same as a direct one.

Fix: push the feature branch to its own ref and open a PR.`;
  }

  const probe = existingAncestorDir(dir);
  if (probe === undefined) return undefined;
  if (git(probe, ['rev-parse', '--show-toplevel']) === undefined) return undefined;

  const branch = git(probe, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (branch === undefined) {
    return `Refusing to ${op} in ${probe}: HEAD names no branch.

A detached HEAD cannot be checked against the protected-branch list, so this
is refused as unknown rather than assumed safe.

Fix: check out a feature branch in a worktree, then ${op} there.`;
  }
  if (!isProtectedBranch(branch)) return undefined;

  return `Refusing to ${op} on ${branch} in ${probe}.

AGENTS.md § Git workflow: never commit or push to main, and never to a branch
this session did not create. Diff size is never a justification.

Fix: move the work onto a feature branch in its own worktree, then ${op} there.

  git worktree add .claude/worktrees/<name> -b worktree-<name>

If this ${op} is genuinely intended, the operator can run it.`;
}

/** The remote ref `github` op `pr_push` would write for a local branch. */
function prHeadRef(cwd: string, branch: string): string | undefined {
  return git(cwd, ['config', '--get', `branch.${branch}.ompPrHeadRef`]);
}

const primed = new Set<string>();
const primeCleared = new Set<string>();

/**
 * Arm prime-guard for this session. Driven from tool_call rather than
 * session_start, which does not fire on a resumed session; re-armed after a
 * compaction, when the prime text has just been summarised away.
 */
function ensurePrimeArmed(cwd: string, sessionId: string, force: boolean): void {
  if (force) primeCleared.delete(sessionId);
  else if (primed.has(sessionId)) return;
  primed.add(sessionId);
  const result = spawnSync(PRIME_GUARD, {
    input: JSON.stringify({
      hook_event_name: 'SessionStart',
      session_id: sessionId,
      cwd,
    }),
    cwd,
    encoding: 'utf-8',
  });
  if (result.error !== undefined) {
    throw new Error(`omp-bridge: cannot run ${PRIME_GUARD}: ${result.error.message}`);
  }
}

/**
 * Once the prime file has been read the sentinel is gone and the guard can
 * only allow, until a compaction re-arms it. Remembering that spares every
 * later call a shell spawn on omp's event loop — the whole per-call floor.
 */
function primeBlock(
  toolName: string,
  cwd: string,
  sessionId: string,
  filePath: string | undefined,
  command: string | undefined,
): string | undefined {
  if (primeCleared.has(sessionId)) return undefined;
  ensurePrimeArmed(cwd, sessionId, false);
  const reason = runGuard(
    PRIME_GUARD,
    buildPayload({ toolName, sessionId, cwd, filePath, command }),
    cwd,
    sessionId,
  );
  if (reason === undefined) primeCleared.add(sessionId);
  return reason;
}

export default function ompBridge(pi: BridgeApi): void {
  pi.on('session_compact', async (_event, ctx) => {
    ensurePrimeArmed(ctx.cwd, ctx.sessionManager.getSessionId(), true);
  });

  pi.on('tool_call', async (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const target = toolTargets(event.toolName, event.input, home());
    const command =
      event.toolName === 'bash' && typeof event.input.command === 'string'
        ? event.input.command
        : undefined;

    const prime = primeBlock(
      claudeToolName(target.tool) ?? event.toolName,
      ctx.cwd,
      sessionId,
      target.paths[0],
      command,
    );
    if (prime !== undefined) return { block: true, reason: prime };

    if (target.unclassified && !ALLOW_UNKNOWN) {
      // `target.tool` is the effective tool: for a device write it is the
      // `xd://` device, which is what has to be triaged, not `write`.
      const unknown = target.tool;
      return {
        block: true,
        reason: `Refusing ${unknown}: this bridge cannot tell which files the call touches.

An unclassified tool blocks rather than passing ungated, so a tool omp added
since this bridge was written cannot slip past the worktree and scout-pass
gates.

Fix: add "${unknown}" to KNOWN_TOOLS in scripts/hooks/omp-bridge-pure.ts
and give it a case in toolTargets naming the paths it touches. To unblock a
session while doing that, set STELLATA_OMP_ALLOW_UNKNOWN_TOOLS=1.`,
      };
    }

    for (const path of target.paths) {
      if (target.mutates) {
        const worktree = mainWorktreeBlock(path, ctx.cwd);
        if (worktree !== undefined) return { block: true, reason: worktree };
      }
      const toolName = claudeToolName(target.tool);
      if (toolName === undefined) continue;
      const reason = runGuard(
        README_GUARD,
        buildPayload({ toolName, sessionId, cwd: ctx.cwd, filePath: path }),
        ctx.cwd,
        sessionId,
      );
      if (reason !== undefined) return { block: true, reason };
    }

    if (event.toolName === 'github') {
      const branches = githubPushBranches(event.input);
      if (branches !== undefined) {
        const current = git(ctx.cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
        const local = branches.length > 0 ? branches : current === undefined ? [] : [current];
        for (const branch of local) {
          const headRef = prHeadRef(ctx.cwd, branch);
          for (const candidate of [branch, headRef]) {
            if (candidate !== undefined && isProtectedBranch(candidate)) {
              return {
                block: true,
                reason: `Refusing github pr_push: it would write ${candidate}.

AGENTS.md § Git workflow protects main and master whatever tool does the push.`,
              };
            }
          }
        }
      }
    }

    if (command !== undefined) {
      const explicitCwd =
        typeof event.input.cwd === 'string' && event.input.cwd !== ''
          ? absolute(event.input.cwd, ctx.cwd)
          : undefined;

      for (const raw of bashWriteTargets(command)) {
        const written = normalizeToolPath(raw, home());
        const worktree = mainWorktreeBlock(written, explicitCwd ?? ctx.cwd);
        if (worktree !== undefined) return { block: true, reason: worktree };
      }

      // One command can carry several: `git commit && git push`, or a `cd`
      // between two repositories. Each is checked where it actually runs.
      const base = explicitCwd ?? ctx.cwd;
      for (const history of gitHistoryOps(command)) {
        const dir = history.dir === undefined ? base : absolute(history.dir, base);
        const branch = protectedBranchBlock(history.op, dir, history.destinations);
        if (branch !== undefined) return { block: true, reason: branch };
      }

      if (needsCommitSweep(command)) {
        const reason = runGuard(
          COMMIT_SWEEP_GUARD,
          buildPayload({ toolName: 'Bash', sessionId, cwd: ctx.cwd, command }),
          ctx.cwd,
          sessionId,
        );
        if (reason !== undefined) return { block: true, reason };
      }
    }

    return undefined;
  });
}

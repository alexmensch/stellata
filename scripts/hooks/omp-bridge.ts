// omp extension that runs the Claude Code guard scripts in this folder.
// Translates omp tool_call / session_start events into the stdin JSON the
// .sh guards read, and their deny verdicts back into an omp block.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import {
  buildPayload,
  needsCommitSweep,
  parseVerdict,
  targetPaths,
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
      attribution: string;
    },
    options: { deliverAs: 'nextTurn' },
  ): void;
  logger: { warn(message: string): void };
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

    for (const path of targetPaths(event.toolName, event.input)) {
      const payload = buildPayload({
        ompTool: event.toolName,
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
      if (needsCommitSweep(command)) {
        const payload = buildPayload({
          ompTool: 'bash',
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

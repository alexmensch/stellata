// Behavioural guard for scripts/hooks/prime-guard.sh: the SessionStart pointer
// must stay small enough that no host truncates it, and the PreToolUse gate
// must hold until the persisted prime output has actually been Read.

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HOOK = resolve(__dirname, '../scripts/hooks/prime-guard.sh');
const SESSION = 'sess-abc123';
const MAX_CONTEXT_BYTES = 1024;

const PRIME_BODY = `# Beads Workflow Context

## Persistent Memories (17)

### some-memory
body
`;

let stateDir: string;
let binDir: string;

function fakeBd(body: string, exitCode = 0): void {
  const path = join(binDir, 'fake-bd.sh');
  writeFileSync(path, `#!/usr/bin/env bash\ncat <<'FIXTURE'\n${body}\nFIXTURE\nexit ${exitCode}\n`);
  chmodSync(path, 0o755);
}

function run(payload: Record<string, unknown>): string {
  return execFileSync('bash', [HOOK], {
    input: JSON.stringify({ session_id: SESSION, ...payload }),
    env: { ...process.env, TMPDIR: stateDir, PRIME_GUARD_BD: join(binDir, 'fake-bd.sh') },
    encoding: 'utf-8',
  });
}

function sessionStart(): { context: string; bytes: number } {
  const stdout = run({ hook_event_name: 'SessionStart', source: 'startup' });
  if (stdout.trim() === '') return { context: '', bytes: 0 };
  const parsed = JSON.parse(stdout) as {
    hookSpecificOutput: { additionalContext: string };
  };
  const context = parsed.hookSpecificOutput.additionalContext;
  return { context, bytes: Buffer.byteLength(context, 'utf-8') };
}

function preToolUse(tool: string, toolInput: Record<string, unknown> = {}): {
  allowed: boolean;
  reason: string;
} {
  const stdout = run({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: toolInput });
  if (stdout.trim() === '') return { allowed: true, reason: '' };
  const parsed = JSON.parse(stdout) as {
    hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
  };
  return {
    allowed: parsed.hookSpecificOutput.permissionDecision !== 'deny',
    reason: parsed.hookSpecificOutput.permissionDecisionReason,
  };
}

function primeFile(): string {
  return join(stateDir, 'claude-prime-guard', `prime-${SESSION}.md`);
}

function sentinel(): string {
  return join(stateDir, 'claude-prime-guard', `unread-${SESSION}`);
}

beforeEach(() => {
  stateDir = realpathSync(mkdtempSync(join(tmpdir(), 'prime-guard-state-')));
  binDir = realpathSync(mkdtempSync(join(tmpdir(), 'prime-guard-bin-')));
  fakeBd(PRIME_BODY);
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
  rmSync(binDir, { recursive: true, force: true });
});

describe('prime-guard SessionStart', () => {
  it('persists the full prime output and points at it by absolute path', () => {
    const { context } = sessionStart();
    expect(context).toContain(primeFile());
    expect(readFileSync(primeFile(), 'utf-8')).toContain('Persistent Memories (17)');
  });

  it('keeps the emitted context small enough that no host truncates it', () => {
    const { bytes } = sessionStart();
    expect(bytes).toBeLessThan(MAX_CONTEXT_BYTES);
  });

  it('names the memory count so the pointer states what is being missed', () => {
    expect(sessionStart().context).toContain('17 persistent project memories');
  });

  it('arms the gate', () => {
    sessionStart();
    expect(existsSync(sentinel())).toBe(true);
  });
});

describe('prime-guard PreToolUse', () => {
  beforeEach(() => {
    sessionStart();
  });

  it('denies an unrelated tool call while the prime output is unread', () => {
    const decision = preToolUse('Bash', { command: 'git status' });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain(primeFile());
  });

  it('denies a Read of some other file', () => {
    expect(preToolUse('Read', { file_path: '/etc/hosts' }).allowed).toBe(false);
  });

  it('allows the Read of the prime file and disarms the gate', () => {
    expect(preToolUse('Read', { file_path: primeFile() }).allowed).toBe(true);
    expect(existsSync(sentinel())).toBe(false);
    expect(preToolUse('Bash', { command: 'git status' }).allowed).toBe(true);
  });

  it('allows a call that names the sentinel as the documented escape hatch', () => {
    expect(preToolUse('Bash', { command: `rm -f ${sentinel()}` }).allowed).toBe(true);
  });
});

describe('prime-guard failure modes', () => {
  it('fails open when bd cannot produce prime output', () => {
    fakeBd('', 1);
    expect(sessionStart().context).toBe('');
    expect(existsSync(sentinel())).toBe(false);
    expect(preToolUse('Bash', { command: 'git status' }).allowed).toBe(true);
  });

  it('leaves a session ungated when SessionStart never ran', () => {
    expect(preToolUse('Bash', { command: 'git status' }).allowed).toBe(true);
  });

  it('re-arms on a later SessionStart so a compaction restores the gate', () => {
    preToolUse('Read', { file_path: primeFile() });
    expect(existsSync(sentinel())).toBe(false);
    sessionStart();
    expect(preToolUse('Bash', { command: 'git status' }).allowed).toBe(false);
  });
});
